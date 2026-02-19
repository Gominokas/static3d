/**
 * @static3d/types — loader types
 *
 * ブラウザ専用ローダー (@static3d/display) で使う型定義。
 * Node.js 依存なし。
 */

/** ローダー全体のオプション */
export interface LoaderOptions {
  /** 同時ダウンロード数（デフォルト: 4） */
  concurrency?: number;
  /** リトライ回数（デフォルト: 3） */
  retryCount?: number;
  /** 初回リトライ待機 ms（指数バックオフ、デフォルト: 1000） */
  retryDelay?: number;
  /** タイムアウト ms（デフォルト: 30000） */
  timeout?: number;
  /**
   * SRI ハッシュ検証を有効化（デフォルト: true）
   * manifest の hash フィールド（"sha256:<hex64>"）で SubresourceIntegrity 検証を行う
   */
  integrity?: boolean;
}

/** 単一アセット取得オプション */
export interface LoadOptions {
  /**
   * レスポンス形式（デフォルト: contentType から自動判定）
   * - 'blob': Blob で返す
   * - 'arraybuffer': ArrayBuffer で返す
   * - 'json': JSON.parse した値を返す
   */
  responseType?: 'blob' | 'arraybuffer' | 'json';
  /** 優先度（デフォルト: 'normal'） */
  priority?: 'high' | 'normal' | 'low';
  /** キャンセル用 AbortSignal */
  signal?: AbortSignal;
}

/** loadAll のオプション */
export interface LoadAllOptions extends LoadOptions {
  /** 取得するアセットキーのフィルタ（指定なし = 全て） */
  keys?: string[];
}

/** 進捗イベント */
export interface ProgressEvent {
  /** ダウンロード済みバイト数 */
  loaded: number;
  /** 合計バイト数（manifest の size から算出） */
  total: number;
  /** 現在ダウンロード中のアセットキー */
  asset: string;
  /** 完了済みアセット数 */
  completedCount: number;
  /** 全アセット数 */
  totalCount: number;
}

/** ロードエラー */
export interface LoadError {
  /** エラー種別 */
  type: 'network' | 'timeout' | 'integrity' | 'not-found' | 'abort' | 'unknown';
  /** アセットキー */
  key: string;
  /** CDN URL */
  url: string;
  /** 元の Error */
  cause?: Error;
  /** HTTP ステータスコード（network エラー時） */
  statusCode?: number;
}

/** useAsset の戻り値 */
export interface AssetResult<T = Blob> {
  /** 取得済みアセットデータ */
  data: T;
  /** アセットキー */
  key: string;
  /** CDN URL */
  url: string;
  /** コンテンツタイプ */
  contentType: string;
}
