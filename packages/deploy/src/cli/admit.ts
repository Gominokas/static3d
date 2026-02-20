/**
 * admit.ts — 環境からローカルにアセット取得コマンド
 *
 * static3d admit --from <environment>
 *
 * 指定環境の R2 プレフィックスからアセットを列挙し、
 * ローカルの src/assets/deferred/ に差分ダウンロードする。
 *
 * 動作:
 *   - R2 のプレフィックス以下の全オブジェクトを列挙
 *   - ローカルに同名ファイルが存在しない or サイズが異なる場合のみダウンロード
 *   - ログ: [ADMIT] Downloaded 2 assets from production (3.2MB)
 *
 * 設定 (static3d.config.json):
 *   "environments": {
 *     "production": { "prefix": "" },
 *     "staging":    { "prefix": "staging/" },
 *     "draft":      { "prefix": "draft/" }
 *   }
 */

import { resolve, dirname } from 'node:path';
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { loadConfig, validateDeployConfig } from '../config/schema.js';
import { resolveR2Credentials } from '../config/auth.js';
import { createR2Client } from '../push/r2.js';
import { resolveEnvironments } from './promote.js';

// ────────────────────────────────────────────────────────────────────────────
// 型定義
// ────────────────────────────────────────────────────────────────────────────

export interface AdmitCommandOptions {
  configPath?: string;
  from?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// R2 オブジェクトのリストアップ
// ────────────────────────────────────────────────────────────────────────────

interface R2ObjectMeta {
  key: string;
  size: number;
}

async function listObjectsWithSize(
  s3: S3Client,
  bucket: string,
  prefix: string
): Promise<R2ObjectMeta[]> {
  const objects: R2ObjectMeta[] = [];
  let token: string | undefined;

  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token })
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key) {
        objects.push({ key: obj.Key, size: obj.Size ?? 0 });
      }
    }
    token = res.NextContinuationToken;
  } while (token);

  return objects;
}

// ────────────────────────────────────────────────────────────────────────────
// R2 オブジェクトのダウンロード
// ────────────────────────────────────────────────────────────────────────────

async function downloadObject(
  s3: S3Client,
  bucket: string,
  key: string,
  destPath: string
): Promise<number> {
  const res = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  );

  if (!res.Body) {
    throw new Error(`[ADMIT] Empty response for key: ${key}`);
  }

  // Node.js の Readable ストリームを Buffer に変換
  const chunks: Uint8Array[] = [];
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);

  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, buffer);

  return buffer.length;
}

// ────────────────────────────────────────────────────────────────────────────
// エクスポート: コマンドエントリーポイント
// ────────────────────────────────────────────────────────────────────────────

export async function admitCommand(opts: AdmitCommandOptions): Promise<void> {
  const { from } = opts;

  if (!from) {
    console.error('[ADMIT] --from is required');
    console.error('  Example: static3d admit --from production');
    process.exit(1);
  }

  if (from === 'local') {
    console.error('[ADMIT] --from local is not valid (cannot admit from local)');
    process.exit(1);
  }

  try {
    const rawConfig = loadConfig(opts.configPath) as unknown as Record<string, unknown>;
    const deployConfig = validateDeployConfig(rawConfig as never);
    const envConfigs = resolveEnvironments(rawConfig);

    if (!envConfigs[from]) {
      throw new Error(
        `[ADMIT] Unknown environment: "${from}". Available: ${Object.keys(envConfigs).join(', ')}`
      );
    }

    const creds = resolveR2Credentials();
    const s3 = createR2Client(creds);
    const bucket = deployConfig.cdn.bucket;
    const prefix = envConfigs[from].prefix;
    const deferredDir = resolve(deployConfig.assets.deferredDir);

    console.log(`[ADMIT] Listing objects in "${bucket}" (prefix: "${prefix || '(root)'}")...`);

    const remoteObjects = await listObjectsWithSize(s3, bucket, prefix);

    if (remoteObjects.length === 0) {
      console.log(`[ADMIT] No objects found in "${from}" environment`);
      return;
    }

    console.log(`[ADMIT] Found ${remoteObjects.length} remote objects`);

    let downloaded = 0;
    let skipped = 0;
    let totalBytes = 0;

    for (const obj of remoteObjects) {
      // プレフィックスを除いたローカルパスを計算
      const relKey = prefix ? obj.key.slice(prefix.length) : obj.key;

      // ハッシュ付きキー（e.g. scene.abc12345.gltf）は除外 — manifest 経由で管理される
      // ここでは全ファイルをそのままダウンロード
      if (!relKey) continue;

      const localPath = resolve(deferredDir, relKey);

      // 差分チェック: ローカルに存在してサイズが同じならスキップ
      if (existsSync(localPath)) {
        const localStat = statSync(localPath);
        if (localStat.size === obj.size) {
          skipped++;
          continue;
        }
      }

      const bytes = await downloadObject(s3, bucket, obj.key, localPath);
      downloaded++;
      totalBytes += bytes;
      console.log(
        `[ADMIT] ↓ ${relKey} (${(bytes / 1024).toFixed(1)}KB)`
      );
    }

    const totalMB = (totalBytes / 1024 / 1024).toFixed(2);
    console.log(
      `[ADMIT] Downloaded ${downloaded} assets from ${from} (${totalMB}MB), skipped ${skipped} unchanged`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
