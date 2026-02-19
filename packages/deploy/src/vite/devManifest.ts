/**
 * devManifest.ts
 *
 * deferred/ ディレクトリの中身をスキャンして、
 * Vite dev server 用のインメモリ manifest を動的に生成する。
 *
 * 仕様:
 *  - version: "dev" 固定
 *  - hash:    "" (空文字) — dev 時は integrity 検証をスキップ
 *  - url:     "/cdn/<key>"  — Vite dev server 上のローカルパス
 *  - dependencies: .gltf ファイルの bufferViews/images から URI 解析して設定
 */

import { resolve, relative } from 'node:path';
import { statSync, readFileSync } from 'node:fs';
import { glob } from 'glob';
import { lookup } from 'mime-types';
import type { DeployManifest, AssetEntry } from '@static3d/types';

// ────────────────────────────────────────────────────────────────────────────
// gltf 依存解析
// ────────────────────────────────────────────────────────────────────────────

interface GltfLike {
  bufferViews?: unknown[];
  buffers?: Array<{ uri?: string }>;
  images?: Array<{ uri?: string }>;
}

/**
 * .gltf ファイルのバッファ/テクスチャ URI を読み取り、
 * deferredDir 相対のキーとして返す。
 * 解析失敗時は空配列を返す（ビルドを止めない）。
 */
export function parseGltfDependencies(
  gltfAbsPath: string,
  deferredDir: string
): string[] {
  try {
    const raw = readFileSync(gltfAbsPath, 'utf-8');
    const gltf = JSON.parse(raw) as GltfLike;
    const uris: string[] = [];

    for (const buf of gltf.buffers ?? []) {
      if (buf.uri && !buf.uri.startsWith('data:')) uris.push(buf.uri);
    }
    for (const img of gltf.images ?? []) {
      if (img.uri && !img.uri.startsWith('data:')) uris.push(img.uri);
    }

    // gltf と同ディレクトリからの相対 URI を deferredDir 相対に変換
    const gltfDir = resolve(gltfAbsPath, '..');
    return uris.map((uri) => {
      const abs = resolve(gltfDir, uri);
      return relative(deferredDir, abs).replace(/\\/g, '/');
    });
  } catch {
    return [];
  }
}

// ────────────────────────────────────────────────────────────────────────────
// dev 用 manifest 生成
// ────────────────────────────────────────────────────────────────────────────

/**
 * deferredDir をスキャンして DeployManifest を返す。
 * 非同期（glob を使うため）。
 */
export async function buildDevManifest(
  deferredDir: string,
  ignorePatterns: string[] = []
): Promise<DeployManifest> {
  const absDeferred = resolve(deferredDir);

  const files = await glob('**/*', {
    cwd: absDeferred,
    nodir: true,
    ignore: ignorePatterns,
    absolute: true,
  });

  const assets: Record<string, AssetEntry> = {};

  for (const absPath of files) {
    const key = relative(absDeferred, absPath).replace(/\\/g, '/');
    const stat = statSync(absPath);
    const contentType = lookup(key) || 'application/octet-stream';

    const entry: AssetEntry = {
      url: `/cdn/${key}`,
      size: stat.size,
      hash: '',           // dev 時は integrity 検証スキップ
      contentType,
    };

    // .gltf: 依存アセットを解析して dependencies フィールドに設定
    if (key.endsWith('.gltf')) {
      const deps = parseGltfDependencies(absPath, absDeferred);
      if (deps.length > 0) {
        entry.dependencies = deps;
      }
    }

    assets[key] = entry;
  }

  return {
    schemaVersion: 1,
    version: 'dev',
    buildTime: new Date().toISOString(),
    assets,
  };
}
