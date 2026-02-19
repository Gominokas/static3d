import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extname, dirname, basename } from 'node:path';
import { execSync } from 'node:child_process';

export interface HashedAsset {
  key: string;
  absolutePath: string;
  size: number;
  hash: string;
  hashedFilename: string;
  hashedKey: string;
}

export function computeHash(data: Buffer, length: number = 8): string {
  const full = createHash('sha256').update(data).digest('hex');
  return full.substring(0, length);
}

export function computeFullHash(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function insertHash(filename: string, hash: string): string {
  const ext = extname(filename);
  const base = basename(filename, ext);
  return `${base}.${hash}${ext}`;
}

/**
 * 全アセットのフルハッシュを連結してSHA-256ダイジェストを計算する。
 * 同じソースセットからは常に同じ値が返るため、Git未初期化環境でも
 * 決定論的なビルドIDとして使える。
 */
export function computeContentDigest(fullHashes: string[]): string {
  // キー順に並べることで収集順序に依存しない
  const sorted = [...fullHashes].sort();
  return createHash('sha256')
    .update(sorted.join('\n'))
    .digest('hex')
    .substring(0, 12);
}

/**
 * Git short SHA を取得する。Git が使えない場合は null を返す。
 */
export function getGitShortSha(): string | null {
  try {
    return execSync('git rev-parse --short HEAD', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

export function hashAsset(
  key: string,
  absolutePath: string,
  size: number,
  hashLength: number = 8
): HashedAsset {
  const data = readFileSync(absolutePath);
  const shortHash = computeHash(data, hashLength);
  const fullHash = computeFullHash(data);

  const dir = dirname(key);
  const filename = basename(key);
  const hashedFilename = insertHash(filename, shortHash);
  const hashedKey = dir === '.' ? hashedFilename : `${dir}/${hashedFilename}`;

  return {
    key,
    absolutePath,
    size,
    hash: `sha256:${fullHash}`,
    hashedFilename,
    hashedKey,
  };
}
