/**
 * AssetProvider.tsx
 *
 * AssetLoader を React Context で提供する Provider。
 * manifestUrl を受け取り、子コンポーネントに loader を配布する。
 */
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AssetLoader } from '../loader/AssetLoader.js';
import type { LoaderOptions, ProgressEvent } from '@static3d/types';

// ────────────────────────────────────────────────────────────────────────────
// Context
// ────────────────────────────────────────────────────────────────────────────

export interface AssetContextValue {
  loader: AssetLoader;
  /** manifest 取得済みか */
  ready: boolean;
  /** manifest 取得エラー */
  error: Error | null;
  /** 現在の進捗 */
  progress: ProgressEvent | null;
}

const AssetContext = createContext<AssetContextValue | null>(null);

// ────────────────────────────────────────────────────────────────────────────
// Provider
// ────────────────────────────────────────────────────────────────────────────

export interface AssetProviderProps {
  manifestUrl: string;
  options?: LoaderOptions;
  children?: React.ReactNode;
}

export function AssetProvider({
  manifestUrl,
  options,
  children,
}: AssetProviderProps): React.JSX.Element {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);

  // manifestUrl or options が変わったら loader を再生成
  const loader = useMemo(
    () => new AssetLoader(manifestUrl, options),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [manifestUrl, JSON.stringify(options)]
  );

  useEffect(() => {
    setReady(false);
    setError(null);

    loader.onProgress((e) => setProgress(e));

    loader
      .init()
      .then(() => setReady(true))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e : new Error(String(e)));
      });

    return () => {
      loader.cancel();
    };
  }, [loader]);

  const value = useMemo<AssetContextValue>(
    () => ({ loader, ready, error, progress }),
    [loader, ready, error, progress]
  );

  return (
    <AssetContext.Provider value={value}>{children}</AssetContext.Provider>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// hook: useAssetContext
// ────────────────────────────────────────────────────────────────────────────

/** AssetContext を取得する。Provider の外で使うと例外をスロー。 */
export function useAssetContext(): AssetContextValue {
  const ctx = useContext(AssetContext);
  if (!ctx) {
    throw new Error(
      '[static3d] useAssetContext must be used inside <AssetProvider>'
    );
  }
  return ctx;
}
