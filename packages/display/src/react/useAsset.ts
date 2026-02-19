/**
 * useAsset.ts
 *
 * 単一アセットを取得する Suspense 対応フック。
 *
 * 使い方:
 *   const { data, url, contentType } = useAsset('models/scene.gltf');
 *
 * Suspense ラッパーで囲む:
 *   <Suspense fallback={<Loading />}>
 *     <MyComponent />   ← useAsset を呼ぶ
 *   </Suspense>
 */
import { use, useMemo } from 'react';
import { useAssetContext } from './AssetProvider.js';
import type { LoadOptions, AssetResult } from '@static3d/types';

// ────────────────────────────────────────────────────────────────────────────
// Promise cache（Suspense 用）
// ────────────────────────────────────────────────────────────────────────────

type CacheEntry =
  | { status: 'pending'; promise: Promise<void> }
  | { status: 'resolved'; value: Blob | ArrayBuffer }
  | { status: 'rejected'; reason: unknown };

const cache = new Map<string, CacheEntry>();

function getCacheKey(manifestUrl: string, assetKey: string, opts?: LoadOptions): string {
  return `${manifestUrl}::${assetKey}::${opts?.responseType ?? ''}`;
}

// ────────────────────────────────────────────────────────────────────────────
// useAsset
// ────────────────────────────────────────────────────────────────────────────

/**
 * Suspense 対応。manifest が ready になるまで Promise を throw する。
 * アセット fetch 中も Promise を throw → Suspense の fallback が表示される。
 */
export function useAsset<T = Blob>(
  key: string,
  options?: LoadOptions
): AssetResult<T> {
  const { loader, ready, error } = useAssetContext();

  // manifest エラーは直接 throw
  if (error) throw error;

  const manifestUrl = loader['manifestUrl'] as string;
  const cacheKey = getCacheKey(manifestUrl, key, options);

  // キャッシュが存在しない or pending の場合は Promise を throw (Suspense)
  if (!ready) {
    // まだ manifest 未取得 → 空 Promise を throw して再 render を待つ
    const pending: CacheEntry = {
      status: 'pending',
      promise: new Promise(() => {
        // この Promise は解決されない — ready になると再 render される
      }),
    };
    throw pending.promise;
  }

  // キャッシュ確認
  let entry = cache.get(cacheKey);

  if (!entry) {
    // 初回: fetch を開始してキャッシュに pending を積む
    const promise = loader
      .load(key, options)
      .then((data) => {
        cache.set(cacheKey, { status: 'resolved', value: data });
      })
      .catch((reason: unknown) => {
        cache.set(cacheKey, { status: 'rejected', reason });
      });

    entry = { status: 'pending', promise };
    cache.set(cacheKey, entry);
  }

  if (entry.status === 'pending') {
    throw entry.promise;
  }

  if (entry.status === 'rejected') {
    throw entry.reason;
  }

  // resolved
  const manifest = loader.getManifest();
  const assetEntry = manifest?.assets[key];

  return {
    data: entry.value as T,
    key,
    url: assetEntry?.url ?? '',
    contentType: assetEntry?.contentType ?? 'application/octet-stream',
  };
}

/** キャッシュを手動でクリア（テスト用途など） */
export function clearAssetCache(): void {
  cache.clear();
}
