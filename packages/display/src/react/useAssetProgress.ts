/**
 * useAssetProgress.ts
 *
 * ローダーの全体進捗を監視するフック。
 *
 * 使い方:
 *   const { loaded, total, percentage } = useAssetProgress();
 */
import { useState, useEffect } from 'react';
import { useAssetContext } from './AssetProvider.js';
import type { ProgressEvent } from '@static3d/types';

export interface ProgressState {
  /** ダウンロード済みバイト数 */
  loaded: number;
  /** 合計バイト数（manifest の size から算出） */
  total: number;
  /** 進捗率 0–100 */
  percentage: number;
  /** 完了済みアセット数 */
  completedCount: number;
  /** 全アセット数 */
  totalCount: number;
  /** 現在処理中のアセットキー（未開始時は null） */
  currentAsset: string | null;
}

const INITIAL: ProgressState = {
  loaded: 0,
  total: 0,
  percentage: 0,
  completedCount: 0,
  totalCount: 0,
  currentAsset: null,
};

export function useAssetProgress(): ProgressState {
  const { progress } = useAssetContext();
  const [state, setState] = useState<ProgressState>(INITIAL);

  useEffect(() => {
    if (!progress) return;

    const { loaded, total, asset, completedCount, totalCount } =
      progress as ProgressEvent;

    setState({
      loaded,
      total,
      percentage: total > 0 ? Math.min(100, (loaded / total) * 100) : 0,
      completedCount,
      totalCount,
      currentAsset: asset ?? null,
    });
  }, [progress]);

  return state;
}
