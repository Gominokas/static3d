import { resolve, relative, basename } from 'node:path';
import { statSync } from 'node:fs';
import { glob } from 'glob';
import type { DeployConfig } from '@static3d/types';

export interface CollectedAsset {
  /** deferredDir からの相対パス（マニフェストキー） */
  key: string;
  /** ファイルシステム上の絶対パス */
  absolutePath: string;
  /** ファイルサイズ（バイト） */
  size: number;
}

export class AssetError extends Error {
  constructor(message: string) {
    super(`[ASSET] ${message}`);
    this.name = 'AssetError';
  }
}

function parseMaxFileSize(maxFileSize: string): number {
  const match = maxFileSize.match(/^(\d+)(MB|GB|KB)$/i);
  if (!match) return Infinity;
  const num = parseInt(match[1], 10);
  const unit = match[2].toUpperCase();
  if (unit === 'KB') return num * 1024;
  if (unit === 'MB') return num * 1024 * 1024;
  if (unit === 'GB') return num * 1024 * 1024 * 1024;
  return Infinity;
}

export async function collectDeferredAssets(
  config: DeployConfig
): Promise<CollectedAsset[]> {
  const deferredDir = resolve(config.assets.deferredDir);
  const ignorePatterns = config.assets.ignore ?? [];
  const maxSize = parseMaxFileSize(config.assets.maxFileSize ?? '100MB');

  const files = await glob('**/*', {
    cwd: deferredDir,
    nodir: true,
    ignore: ignorePatterns,
    absolute: true,
  });

  const assets: CollectedAsset[] = [];
  const keysLower = new Map<string, string>();

  for (const absolutePath of files) {
    const key = relative(deferredDir, absolutePath).replace(/\\/g, '/');
    const stat = statSync(absolutePath);

    // サイズチェック
    if (stat.size > maxSize) {
      throw new AssetError(
        `${key} (${(stat.size / 1024 / 1024).toFixed(1)}MB) exceeds maxFileSize (${config.assets.maxFileSize ?? '100MB'})`
      );
    }

    // case-insensitive 重複チェック
    const lower = key.toLowerCase();
    if (keysLower.has(lower)) {
      const existing = keysLower.get(lower)!;
      if (existing !== key) {
        console.warn(
          `[ASSET] Warning: "${existing}" and "${key}" differ only in case`
        );
      }
    }
    keysLower.set(lower, key);

    assets.push({ key, absolutePath, size: stat.size });
  }

  return assets;
}
