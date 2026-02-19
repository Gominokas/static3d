import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import type { R2Credentials } from '../config/auth.js';

export interface DiffResult {
  /** R2に存在しない → アップロード必要 */
  toUpload: string[];
  /** R2に既に存在する → スキップ */
  alreadyExists: string[];
}

/**
 * dist/cdn/ 以下のファイルキー一覧とR2の現状を比較して差分を返す。
 *
 * コンテンツハッシュがファイル名に含まれているため
 * 「同名ファイル = 同一内容」が保証される。
 * → R2に既に存在するキーは無条件スキップできる。
 */
export async function computeDiff(
  s3: S3Client,
  bucket: string,
  localKeys: string[]
): Promise<DiffResult> {
  const remoteKeys = new Set<string>();

  // R2のオブジェクト一覧を全ページ取得
  let continuationToken: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
      })
    );

    for (const obj of res.Contents ?? []) {
      if (obj.Key) remoteKeys.add(obj.Key);
    }

    continuationToken = res.NextContinuationToken;
  } while (continuationToken);

  const toUpload: string[] = [];
  const alreadyExists: string[] = [];

  for (const key of localKeys) {
    if (remoteKeys.has(key)) {
      alreadyExists.push(key);
    } else {
      toUpload.push(key);
    }
  }

  return { toUpload, alreadyExists };
}
