import { readFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import type { HashedAsset } from './hash.js';

export interface GltfRewriteResult {
  /** 書き換え後のJSON文字列 */
  rewrittenContent: string;
  /** 検出された依存ファイルのキー一覧 */
  dependencies: string[];
}

/**
 * JSONを再帰走査し、"uri" フィールドを書き換える
 */
function rewriteUris(
  node: unknown,
  rewriter: (uri: string) => string | null,
  foundUris: string[]
): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => rewriteUris(item, rewriter, foundUris));
  }

  if (node !== null && typeof node === 'object') {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(
      node as Record<string, unknown>
    )) {
      if (
        key === 'uri' &&
        typeof value === 'string' &&
        !value.startsWith('data:') &&
        !value.startsWith('http:') &&
        !value.startsWith('https:') &&
        !value.startsWith('blob:') &&
        !value.startsWith('ipfs:') &&
        value !== '#'
      ) {
        foundUris.push(value);
        const rewritten = rewriter(value);
        result[key] = rewritten ?? value;
      } else {
        result[key] = rewriteUris(value, rewriter, foundUris);
      }
    }

    return result;
  }

  return node;
}

export function rewriteGltf(
  gltfKey: string,
  gltfAbsolutePath: string,
  deferredDir: string,
  cdnBaseUrl: string,
  hashedAssets: Map<string, HashedAsset>
): GltfRewriteResult {
  const raw = readFileSync(gltfAbsolutePath, 'utf-8');
  const parsed = JSON.parse(raw);
  const gltfDir = dirname(gltfAbsolutePath);

  const dependencies: string[] = [];
  const foundUris: string[] = [];

  const rewritten = rewriteUris(
    parsed,
    (uri: string) => {
      // ../を含むパスを正規化
      const resolvedPath = resolve(gltfDir, uri);
      const key = relative(resolve(deferredDir), resolvedPath).replace(
        /\\/g,
        '/'
      );

      // deferredDir外への参照はエラー
      if (key.startsWith('..')) {
        throw new Error(
          `[GLTF] ${gltfKey} references "${uri}" which resolves outside deferred dir`
        );
      }

      const hashed = hashedAssets.get(key);
      if (!hashed) {
        throw new Error(
          `[GLTF] ${gltfKey} references "${uri}" (resolved: ${key}) but not found in deferred/`
        );
      }

      dependencies.push(key);
      const cdnUrl = `${cdnBaseUrl}/${hashed.hashedKey}`;
      return cdnUrl;
    },
    foundUris
  );

  return {
    rewrittenContent: JSON.stringify(rewritten),
    dependencies,
  };
}
