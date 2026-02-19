import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { createReadStream, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { lookup } from 'mime-types';
import type { R2Credentials } from '../config/auth.js';
import { computeDiff } from './diff.js';

const MULTIPART_THRESHOLD = 5 * 1024 * 1024; // 5MB以上はマルチパート

export interface R2UploadResult {
  uploaded: number;
  skipped: number;
  totalBytes: number;
}

export function createR2Client(creds: R2Credentials): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: creds.endpoint,
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
    },
    // R2はpath-styleを使う
    forcePathStyle: false,
  });
}

/**
 * R2との疎通確認
 * バケットが存在してアクセス可能かを検証する。
 */
export async function verifyR2Access(
  s3: S3Client,
  bucket: string
): Promise<void> {
  try {
    await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[R2] Cannot access bucket "${bucket}": ${msg}\n` +
        `  Check CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY`
    );
  }
}

/**
 * dist/cdn/ 以下のアセットをR2に差分アップロードする。
 * コンテンツハッシュ名なので既存キーはスキップ。
 */
export async function uploadToR2(
  s3: S3Client,
  bucket: string,
  cdnOutputDir: string,
  hashedKeys: string[],
  onProgress?: (uploaded: number, total: number, key: string) => void
): Promise<R2UploadResult> {
  const cdnDir = resolve(cdnOutputDir);

  // 差分計算
  const diff = await computeDiff(s3, bucket, hashedKeys);

  console.log(
    `[R2] ${diff.toUpload.length} to upload, ${diff.alreadyExists.length} already exist`
  );

  let uploaded = 0;
  let totalBytes = 0;

  for (const key of diff.toUpload) {
    const filePath = join(cdnDir, key);
    const size = statSync(filePath).size;
    const contentType = lookup(key) || 'application/octet-stream';

    onProgress?.(uploaded, diff.toUpload.length, key);

    if (size >= MULTIPART_THRESHOLD) {
      // 5MB以上はマルチパートアップロード
      const upload = new Upload({
        client: s3,
        params: {
          Bucket: bucket,
          Key: key,
          Body: createReadStream(filePath),
          ContentType: contentType,
          // コンテンツハッシュ名なので immutable キャッシュ
          CacheControl: 'public, max-age=31536000, immutable',
        },
      });
      await upload.done();
    } else {
      const { readFileSync } = await import('node:fs');
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: readFileSync(filePath),
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        })
      );
    }

    uploaded++;
    totalBytes += size;
    console.log(`[R2] ✓ ${key} (${(size / 1024).toFixed(1)}KB)`);
  }

  // スキップしたファイルをまとめて表示
  if (diff.alreadyExists.length > 0) {
    console.log(`[R2] Skipped ${diff.alreadyExists.length} unchanged files`);
  }

  return { uploaded, skipped: diff.alreadyExists.length, totalBytes };
}

/**
 * 指定したキー一覧をR2から削除する（旧世代クリーンアップ用）
 */
export async function deleteFromR2(
  s3: S3Client,
  bucket: string,
  keys: string[]
): Promise<void> {
  if (keys.length === 0) return;

  // DeleteObjects は最大1000件
  const CHUNK = 1000;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const chunk = keys.slice(i, i + CHUNK);
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: chunk.map((Key) => ({ Key })),
          Quiet: true,
        },
      })
    );
    console.log(`[R2] Deleted ${chunk.length} old assets`);
  }
}

/**
 * R2バケット内の全オブジェクトキー一覧を返す
 */
export async function listAllR2Keys(
  s3: S3Client,
  bucket: string
): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
      })
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);

  return keys;
}
