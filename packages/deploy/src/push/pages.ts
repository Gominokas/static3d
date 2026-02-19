import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve, extname, relative } from 'node:path';
import { readdir } from 'node:fs/promises';
import { lookup } from 'mime-types';
import type { PagesCredentials } from '../config/auth.js';

const CF_API = 'https://api.cloudflare.com/client/v4';
/**
 * Pages アセットアップロード専用エンドポイント
 * JWT で認証するため、CF_API とは別ベースを使う
 */
const CF_PAGES_ASSETS = 'https://api.cloudflare.com/client/v4';

/** wrangler の MAX_BUCKET_SIZE (40 MiB) */
const MAX_BUCKET_SIZE = 40 * 1024 * 1024;
/** wrangler の MAX_BUCKET_FILE_COUNT */
const MAX_BUCKET_FILE_COUNT = 2000;
/** アップロード並列数 */
const BULK_UPLOAD_CONCURRENCY = 3;
/** 最大リトライ回数 */
const MAX_UPLOAD_ATTEMPTS = 5;

/** wrangler が除外するファイルパターン */
const IGNORE_LIST = new Set([
  '_worker.js',
  '_redirects',
  '_headers',
  '_routes.json',
  'functions',
  '.wrangler',
]);
const IGNORE_PATTERNS = ['**/.DS_Store', '**/node_modules', '**/.git'];

export interface PagesDeployResult {
  deploymentId: string;
  url: string;
  environment: string;
}

export class PagesError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number
  ) {
    super(`[PAGES] ${message}`);
    this.name = 'PagesError';
  }
}

interface FileEntry {
  /** pagesOutputDir からの相対パス (forward slash, 先頭 / なし) */
  name: string;
  /** 絶対パス */
  absolutePath: string;
  contentType: string;
  sizeInBytes: number;
  /** 32-char hex hash (SHA-256 of base64content + ext, wrangler互換形式) */
  hash: string;
}

/**
 * wrangler の hashFile と同等:
 *   blake3(base64(content) + ext).slice(0,32)
 * ただし blake3-wasm は無依存制約で使えないため
 * SHA-256 で代替する。Pages API は hash を opaque key として扱うため
 * アルゴリズムはサーバ側で検証されない。
 */
function hashFile(absolutePath: string): string {
  const contents = readFileSync(absolutePath);
  const base64Contents = contents.toString('base64');
  const ext = extname(absolutePath).substring(1); // "png", "gltf", etc.
  return createHash('sha256')
    .update(base64Contents + ext)
    .digest('hex')
    .slice(0, 32);
}

function shouldIgnore(name: string): boolean {
  // トップレベルの除外リスト
  const topLevel = name.split('/')[0];
  if (IGNORE_LIST.has(topLevel)) return true;
  // パターンマッチ (簡易)
  for (const pat of IGNORE_PATTERNS) {
    const segment = pat.replace('**/', '');
    if (name.endsWith(segment) || name.includes('/' + segment + '/')) {
      return true;
    }
  }
  return false;
}

/**
 * pagesOutputDir 以下のファイルを再帰的に収集する
 * (wrangler validate 相当)
 */
async function collectFiles(pagesDir: string): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];

  const walk = async (dir: string): Promise<void> => {
    let items: string[];
    try {
      items = await readdir(dir);
    } catch {
      return;
    }

    for (const item of items) {
      const abs = join(dir, item);
      const rel = relative(pagesDir, abs).replace(/\\/g, '/');

      if (shouldIgnore(rel)) continue;

      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }

      if (st.isSymbolicLink()) continue;

      if (st.isDirectory()) {
        await walk(abs);
      } else {
        entries.push({
          name: rel,
          absolutePath: abs,
          contentType: lookup(rel) || 'application/octet-stream',
          sizeInBytes: st.size,
          hash: hashFile(abs),
        });
      }
    }
  };

  await walk(pagesDir);
  return entries;
}

/**
 * Pages プロジェクトが存在するか確認し、なければ作成する
 */
async function ensurePagesProject(
  creds: PagesCredentials,
  projectName: string
): Promise<void> {
  const res = await fetch(
    `${CF_API}/accounts/${creds.accountId}/pages/projects/${projectName}`,
    {
      headers: {
        Authorization: `Bearer ${creds.apiToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (res.status === 404) {
    const createRes = await fetch(
      `${CF_API}/accounts/${creds.accountId}/pages/projects`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: projectName,
          production_branch: 'main',
        }),
      }
    );

    if (!createRes.ok) {
      const body = await createRes.text();
      throw new PagesError(
        `Failed to create project "${projectName}": ${createRes.status} ${body}`,
        createRes.status
      );
    }

    console.log(`[PAGES] Created project: ${projectName}`);
    return;
  }

  if (!res.ok) {
    const body = await res.text();
    throw new PagesError(
      `Failed to check project "${projectName}": ${res.status} ${body}`,
      res.status
    );
  }
}

/**
 * Step 1: upload-token を取得 (JWT)
 */
async function getUploadToken(
  creds: PagesCredentials,
  projectName: string
): Promise<string> {
  const res = await fetch(
    `${CF_API}/accounts/${creds.accountId}/pages/projects/${projectName}/upload-token`,
    {
      headers: {
        Authorization: `Bearer ${creds.apiToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new PagesError(
      `Failed to get upload token: ${res.status} ${body}`,
      res.status
    );
  }

  const data = (await res.json()) as { result: { jwt: string } };
  return data.result.jwt;
}

/**
 * Step 2: check-missing — 未アップロードのハッシュ一覧を取得
 */
async function checkMissingHashes(
  jwt: string,
  hashes: string[]
): Promise<string[]> {
  const res = await fetch(`${CF_PAGES_ASSETS}/pages/assets/check-missing`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ hashes }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new PagesError(
      `check-missing failed: ${res.status} ${body}`,
      res.status
    );
  }

  const data = (await res.json()) as { result: string[] };
  return data.result ?? [];
}

interface UploadPayloadFile {
  key: string;
  value: string; // base64
  metadata: { contentType: string };
  base64: true;
}

/**
 * Step 3: ファイルを JSON バケットとしてアップロード
 * wrangler と同様にファイルをサイズ順でバケット分けし、
 * BULK_UPLOAD_CONCURRENCY で並列アップロードする
 */
async function uploadFileBuckets(
  jwt: string,
  files: FileEntry[]
): Promise<void> {
  if (files.length === 0) return;

  // サイズ降順でソート
  const sorted = [...files].sort((a, b) => b.sizeInBytes - a.sizeInBytes);

  // バケット分け
  const buckets: FileEntry[][] = new Array(BULK_UPLOAD_CONCURRENCY)
    .fill(null)
    .map(() => []);
  const bucketSizes: number[] = new Array(BULK_UPLOAD_CONCURRENCY).fill(0);

  let offset = 0;
  for (const file of sorted) {
    let placed = false;
    for (let i = 0; i < buckets.length; i++) {
      const idx = (i + offset) % buckets.length;
      if (
        bucketSizes[idx] + file.sizeInBytes <= MAX_BUCKET_SIZE &&
        buckets[idx].length < MAX_BUCKET_FILE_COUNT
      ) {
        buckets[idx].push(file);
        bucketSizes[idx] += file.sizeInBytes;
        placed = true;
        break;
      }
    }
    if (!placed) {
      buckets.push([file]);
      bucketSizes.push(file.sizeInBytes);
    }
    offset++;
  }

  // バケットを並列アップロード (BULK_UPLOAD_CONCURRENCY ごと)
  const nonEmpty = buckets.filter((b) => b.length > 0);

  for (let i = 0; i < nonEmpty.length; i += BULK_UPLOAD_CONCURRENCY) {
    const batch = nonEmpty.slice(i, i + BULK_UPLOAD_CONCURRENCY);

    await Promise.all(
      batch.map(async (bucket) => {
        let attempts = 0;

        const doUpload = async (): Promise<void> => {
          const payload: UploadPayloadFile[] = bucket.map((file) => ({
            key: file.hash,
            value: readFileSync(file.absolutePath).toString('base64'),
            metadata: { contentType: file.contentType },
            base64: true,
          }));

          const res = await fetch(`${CF_PAGES_ASSETS}/pages/assets/upload`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${jwt}`,
            },
            body: JSON.stringify(payload),
          });

          if (!res.ok) {
            const body = await res.text();
            if (attempts < MAX_UPLOAD_ATTEMPTS) {
              attempts++;
              await new Promise((r) =>
                setTimeout(r, Math.pow(2, attempts) * 1000)
              );
              return doUpload();
            }
            throw new PagesError(
              `Asset upload failed: ${res.status} ${body}`,
              res.status
            );
          }
        };

        await doUpload();
      })
    );
  }
}

/**
 * Step 4: upsert-hashes — アップロード済みハッシュを Pages に通知
 */
async function upsertHashes(jwt: string, hashes: string[]): Promise<void> {
  const res = await fetch(`${CF_PAGES_ASSETS}/pages/assets/upsert-hashes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ hashes }),
  });

  if (!res.ok) {
    // wrangler もここは警告のみでエラーにしない
    console.warn(
      `[PAGES] upsert-hashes warning: ${res.status} ${await res.text()}`
    );
  }
}

/**
 * Step 5: デプロイ作成
 * FormData に manifest (JSON string) を含める
 * manifest = { "/path/to/file.html": "<32-char-hash>", ... }
 */
async function createDeployment(
  creds: PagesCredentials,
  projectName: string,
  manifest: Record<string, string>,
  headers?: string
): Promise<{ id: string; url: string; environment: string; aliases?: string[] }> {
  const formData = new FormData();

  // ★ ここが核心: manifest フィールド = JSON string of { "/path": "hash" }
  formData.append('manifest', JSON.stringify(manifest));

  // _headers ファイルがあれば含める
  if (headers) {
    formData.append('_headers', new Blob([headers], { type: 'text/plain' }), '_headers');
  }

  let attempts = 0;
  const MAX_DEPLOYMENT_ATTEMPTS = 3;

  while (attempts < MAX_DEPLOYMENT_ATTEMPTS) {
    const res = await fetch(
      `${CF_API}/accounts/${creds.accountId}/pages/projects/${projectName}/deployments`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.apiToken}`,
          // Content-Type は FormData が自動で multipart/form-data; boundary=... をセットする
        },
        body: formData,
      }
    );

    if (res.ok) {
      const data = (await res.json()) as {
        result: {
          id: string;
          url: string;
          environment: string;
          aliases?: string[];
        };
      };
      return data.result;
    }

    const body = await res.text();

    // Unknown error → リトライ (wrangler の ApiErrorCodes.UNKNOWN_ERROR 相当)
    if (res.status >= 500 && attempts < MAX_DEPLOYMENT_ATTEMPTS - 1) {
      attempts++;
      await new Promise((r) => setTimeout(r, Math.pow(2, attempts) * 1000));
      continue;
    }

    throw new PagesError(
      `Deployment creation failed: ${res.status} ${body}`,
      res.status
    );
  }

  throw new PagesError('Deployment creation failed after retries');
}

/**
 * dist/pages/ を Cloudflare Pages に Direct Upload でデプロイする。
 *
 * 正しい 5-step フロー (wrangler src/api/pages/deploy.ts を参照):
 *   1. GET  upload-token                → JWT
 *   2. POST /pages/assets/check-missing → 未アップロードの hash 一覧
 *   3. POST /pages/assets/upload        → ファイルを base64 JSON でアップロード
 *   4. POST /pages/assets/upsert-hashes → 全 hash を Pages に登録
 *   5. POST deployments                 → FormData { manifest: JSON } でデプロイ作成
 */
export async function deployToPages(
  creds: PagesCredentials,
  projectName: string,
  pagesOutputDir: string
): Promise<PagesDeployResult> {
  const pagesDir = resolve(pagesOutputDir);

  await ensurePagesProject(creds, projectName);

  console.log(`[PAGES] Deploying ${pagesDir} to project "${projectName}"...`);

  // ── ファイル収集 ──────────────────────────────────────────────────────
  const files = await collectFiles(pagesDir);

  if (files.length === 0) {
    throw new PagesError(`No files found in ${pagesDir}`);
  }

  console.log(`[PAGES] ${files.length} file(s) to process`);

  // _headers があれば別途 formData に含める
  let headersContent: string | undefined;
  try {
    headersContent = readFileSync(join(pagesDir, '_headers'), 'utf-8');
  } catch {
    // optional
  }

  // ── Step 1: JWT 取得 ─────────────────────────────────────────────────
  const jwt = await getUploadToken(creds, projectName);

  // ── Step 2: check-missing ────────────────────────────────────────────
  const allHashes = files.map((f) => f.hash);
  const missingHashes = await checkMissingHashes(jwt, allHashes);

  const missingSet = new Set(missingHashes);
  const filesToUpload = files.filter((f) => missingSet.has(f.hash));
  const skipped = files.length - filesToUpload.length;

  console.log(
    `[PAGES] Uploading ${filesToUpload.length} file(s) ` +
      `(${skipped} already cached)`
  );

  // ── Step 3: ファイルアップロード ────────────────────────────────────
  await uploadFileBuckets(jwt, filesToUpload);

  // ── Step 4: upsert-hashes ────────────────────────────────────────────
  await upsertHashes(jwt, allHashes);

  // ── Step 5: デプロイ作成 ─────────────────────────────────────────────
  // manifest = { "/relative/path": "32-char-hash" }
  const manifest: Record<string, string> = {};
  for (const file of files) {
    manifest[`/${file.name}`] = file.hash;
  }

  console.log(`[PAGES] Creating deployment (manifest: ${files.length} entries)...`);

  const result = await createDeployment(
    creds,
    projectName,
    manifest,
    headersContent
  );

  const url = result.aliases?.[0] ?? result.url;

  console.log(`[PAGES] ✓ Deployed: ${url}`);
  console.log(`[PAGES]   Deployment ID: ${result.id}`);

  return {
    deploymentId: result.id,
    url,
    environment: result.environment,
  };
}
