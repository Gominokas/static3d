/**
 * loader/types.ts
 *
 * @static3d/types の型を re-export しつつ、
 * display パッケージ内部で使うローダー専用型を追加定義する。
 */
export type {
  LoaderOptions,
  LoadOptions,
  LoadAllOptions,
  ProgressEvent,
  LoadError,
  AssetResult,
} from '@static3d/types';

import type { LoadError } from '@static3d/types';

/** ダウンロードキューに積む内部エントリ */
export interface QueueEntry {
  key: string;
  url: string;
  contentType: string;
  sizeInBytes: number;
  priority: 'high' | 'normal' | 'low';
  resolve: (value: Blob | ArrayBuffer) => void;
  reject: (reason: LoadError) => void;
  signal?: AbortSignal;
  responseType: 'blob' | 'arraybuffer' | 'json';
}

/** loadAll の戻り値マップ */
export type AssetMap = Map<string, Blob>;
