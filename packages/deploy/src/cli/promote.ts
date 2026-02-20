/**
 * promote.ts — 環境間アセット移動コマンド
 *
 * static3d promote --from <source> --to <target>
 *
 * 環境:
 *   local      — ローカルの deferred/ ディレクトリ
 *   draft      — R2 の draft/ プレフィックス
 *   staging    — R2 の staging/ プレフィックス
 *   production — R2 のルートプレフィックス（""）
 *
 * 動作:
 *   local → production/staging/draft:
 *     ローカルの deferred/ 内ファイルを R2 に直接アップロード
 *   R2 → R2 (draft→staging, staging→production 等):
 *     R2 内の CopyObject でバケット内コピー
 *
 * 設定 (static3d.config.json):
 *   "environments": {
 *     "draft":      { "prefix": "draft/" },
 *     "staging":    { "prefix": "staging/" },
 *     "production": { "prefix": "" }
 *   }
 */

import { resolve, relative } from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import { glob } from 'glob';
import {
  S3Client,
  CopyObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { lookup } from 'mime-types';
import { loadConfig, validateDeployConfig } from '../config/schema.js';
import { resolveR2Credentials } from '../config/auth.js';
import { createR2Client } from '../push/r2.js';

// ────────────────────────────────────────────────────────────────────────────
// 型定義
// ────────────────────────────────────────────────────────────────────────────

export type EnvironmentName = 'local' | 'draft' | 'staging' | 'production';

export interface EnvironmentConfig {
  prefix: string;
}

export interface PromoteCommandOptions {
  configPath?: string;
  from?: string;
  to?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// ユーティリティ
// ────────────────────────────────────────────────────────────────────────────

const MULTIPART_THRESHOLD = 5 * 1024 * 1024;

/** 設定から environments マップを取得する */
export function resolveEnvironments(
  rawConfig: Record<string, unknown>
): Record<string, EnvironmentConfig> {
  const raw = rawConfig['environments'];
  if (!raw || typeof raw !== 'object') {
    // デフォルト値
    return {
      draft: { prefix: 'draft/' },
      staging: { prefix: 'staging/' },
      production: { prefix: '' },
    };
  }
  return raw as Record<string, EnvironmentConfig>;
}

/** R2 プレフィックス以下の全オブジェクトキーを列挙する */
async function listPrefixedKeys(
  s3: S3Client,
  bucket: string,
  prefix: string
): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token })
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    token = res.NextContinuationToken;
  } while (token);
  return keys;
}

// ────────────────────────────────────────────────────────────────────────────
// local → R2 アップロード
// ────────────────────────────────────────────────────────────────────────────

async function promoteLocalToR2(
  s3: S3Client,
  bucket: string,
  deferredDir: string,
  toPrefix: string
): Promise<void> {
  const absDeferred = resolve(deferredDir);
  const files = await glob('**/*', { cwd: absDeferred, nodir: true, absolute: true });

  let uploaded = 0;
  let totalBytes = 0;

  for (const filePath of files) {
    const relKey = relative(absDeferred, filePath).replace(/\\/g, '/');
    const destKey = toPrefix ? `${toPrefix}${relKey}` : relKey;
    const contentType = lookup(relKey) || 'application/octet-stream';
    const size = statSync(filePath).size;

    if (size >= MULTIPART_THRESHOLD) {
      const { createReadStream } = await import('node:fs');
      const upload = new Upload({
        client: s3,
        params: {
          Bucket: bucket,
          Key: destKey,
          Body: createReadStream(filePath),
          ContentType: contentType,
        },
      });
      await upload.done();
    } else {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: destKey,
          Body: readFileSync(filePath),
          ContentType: contentType,
        })
      );
    }

    uploaded++;
    totalBytes += size;
    console.log(`[PROMOTE] ↑ ${relKey} → ${destKey} (${(size / 1024).toFixed(1)}KB)`);
  }

  console.log(
    `[PROMOTE] Done: ${uploaded} files uploaded to "${toPrefix || '(root)'}" (${(totalBytes / 1024 / 1024).toFixed(2)}MB total)`
  );
}

// ────────────────────────────────────────────────────────────────────────────
// R2 プレフィックス間コピー
// ────────────────────────────────────────────────────────────────────────────

async function promoteR2ToR2(
  s3: S3Client,
  bucket: string,
  fromPrefix: string,
  toPrefix: string
): Promise<void> {
  const sourceKeys = await listPrefixedKeys(s3, bucket, fromPrefix);

  if (sourceKeys.length === 0) {
    console.log(`[PROMOTE] No objects found under prefix "${fromPrefix}"`);
    return;
  }

  let copied = 0;

  for (const sourceKey of sourceKeys) {
    // fromPrefix 部分を toPrefix に置換
    const relKey = fromPrefix ? sourceKey.slice(fromPrefix.length) : sourceKey;
    const destKey = toPrefix ? `${toPrefix}${relKey}` : relKey;

    await s3.send(
      new CopyObjectCommand({
        Bucket: bucket,
        CopySource: `${bucket}/${encodeURIComponent(sourceKey)}`,
        Key: destKey,
      })
    );

    copied++;
    console.log(`[PROMOTE] ✓ ${sourceKey} → ${destKey}`);
  }

  console.log(`[PROMOTE] Done: ${copied} objects copied from "${fromPrefix}" to "${toPrefix || '(root)'}"`);
}

// ────────────────────────────────────────────────────────────────────────────
// エクスポート: コマンドエントリーポイント
// ────────────────────────────────────────────────────────────────────────────

export async function promoteCommand(opts: PromoteCommandOptions): Promise<void> {
  const { from, to } = opts;

  if (!from || !to) {
    console.error('[PROMOTE] --from and --to are required');
    console.error('  Example: static3d promote --from local --to production');
    process.exit(1);
  }

  try {
    const rawConfig = loadConfig(opts.configPath) as unknown as Record<string, unknown>;
    const deployConfig = validateDeployConfig(rawConfig as never);
    const envConfigs = resolveEnvironments(rawConfig);

    // "local" は特別扱い
    if (from !== 'local' && !envConfigs[from]) {
      throw new Error(`[PROMOTE] Unknown source environment: "${from}". Available: local, ${Object.keys(envConfigs).join(', ')}`);
    }
    if (!envConfigs[to]) {
      throw new Error(`[PROMOTE] Unknown target environment: "${to}". Available: ${Object.keys(envConfigs).join(', ')}`);
    }

    const creds = resolveR2Credentials();
    const s3 = createR2Client(creds);
    const bucket = deployConfig.cdn.bucket;

    console.log(`[PROMOTE] ${from} → ${to} (bucket: ${bucket})`);

    if (from === 'local') {
      const deferredDir = deployConfig.assets.deferredDir;
      const toPrefix = envConfigs[to].prefix;
      await promoteLocalToR2(s3, bucket, deferredDir, toPrefix);
    } else {
      const fromPrefix = envConfigs[from].prefix;
      const toPrefix = envConfigs[to].prefix;
      await promoteR2ToR2(s3, bucket, fromPrefix, toPrefix);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
