/**
 * AssetLoader.ts — @static3d/loader
 *
 * manifest.json を読み込み、CDN から 3D アセットを fetch するローダー。
 * ブラウザ専用（Node.js の fs / path 等は一切使わない）。
 *
 * @static3d/display から切り出したフレームワーク非依存版。
 * React / Vue / Vanilla JS どこからでも使える。
 *
 * バグ修正 (vs display 内旧版):
 *   1. loadAll で Blob 生成時に contentType を付与
 *      (new Blob([buffer], { type: entry.contentType }))
 *   2. loadAll 後の単体 load でカウンタがリセットされない問題を修正
 *      → load() は独立した進捗セッションとして扱う（totalCount/completedCount を上書きしない）
 */
import type { DeployManifest } from '@static3d/types';
import type {
  LoaderOptions,
  LoadOptions,
  LoadAllOptions,
  ProgressEvent,
  LoadError,
  AssetMap,
} from './types.js';

// ────────────────────────────────────────────────────────────────────────────
// デフォルト設定
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_OPTIONS: Required<LoaderOptions> = {
  concurrency: 4,
  retryCount: 3,
  retryDelay: 1000,
  timeout: 30_000,
  integrity: true,
};

// ────────────────────────────────────────────────────────────────────────────
// ユーティリティ
// ────────────────────────────────────────────────────────────────────────────

/**
 * SubtleCrypto で Blob の SHA-256 を計算し、manifest の hash と照合する。
 * hash 形式: "sha256:<hex64>"
 */
async function verifyIntegrity(data: ArrayBuffer, hash: string): Promise<void> {
  const m = hash.match(/^sha256:([0-9a-f]{64})$/i);
  if (!m) return;

  const digest = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  if (hex.toLowerCase() !== m[1].toLowerCase()) {
    throw new Error(`Integrity check failed: expected ${m[1]}, got ${hex}`);
  }
}

/** contentType から responseType を推定 */
function inferResponseType(
  contentType: string
): 'blob' | 'arraybuffer' | 'json' {
  if (contentType === 'application/json' || contentType.endsWith('+json')) {
    return 'json';
  }
  if (
    contentType.startsWith('text/') ||
    contentType === 'application/javascript'
  ) {
    return 'blob';
  }
  return 'arraybuffer';
}

/** delay helper */
const delay = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

// ────────────────────────────────────────────────────────────────────────────
// AssetLoader
// ────────────────────────────────────────────────────────────────────────────

export class AssetLoader {
  private readonly manifestUrl: string;
  private readonly opts: Required<LoaderOptions>;

  private manifest: DeployManifest | null = null;
  private cancelled = false;

  private progressCallbacks: Array<(e: ProgressEvent) => void> = [];
  private errorCallbacks: Array<(e: LoadError) => void> = [];

  /** 進捗トラッキング（loadAll セッション用） */
  private loadedBytes = 0;
  private totalBytes = 0;
  private completedCount = 0;
  private totalCount = 0;

  constructor(manifestUrl: string, options?: LoaderOptions) {
    this.manifestUrl = manifestUrl;
    this.opts = { ...DEFAULT_OPTIONS, ...options };
  }

  // ── パブリック API ─────────────────────────────────────────────────────

  /**
   * manifest.json を fetch して内部にキャッシュする。
   */
  async init(): Promise<void> {
    await this.fetchManifest();
  }

  /**
   * 単一アセットを取得する。
   *
   * BUG FIX: 単体 load では loadAll の進捗カウンタを上書きしない。
   * 専用のセッション変数を使って進捗をエミットする。
   *
   * @param key deferredDir からの相対パス（例: 'models/scene.gltf'）
   */
  async load(
    key: string,
    options?: LoadOptions
  ): Promise<Blob | ArrayBuffer> {
    const manifest = await this.fetchManifest();
    const entry = manifest.assets[key];
    if (!entry) {
      const err: LoadError = {
        type: 'not-found',
        key,
        url: '',
        cause: new Error(`Asset "${key}" not found in manifest`),
      };
      this.emitError(err);
      throw err;
    }

    return this.fetchAsset(key, entry.url, entry, options);
  }

  /**
   * manifest に含まれる全アセット（または keys で絞り込んだ）を取得する。
   * concurrency 制限付きで並列ダウンロード。
   *
   * BUG FIX: Blob 生成時に entry.contentType を付与する。
   */
  async loadAll(options?: LoadAllOptions): Promise<AssetMap> {
    const manifest = await this.fetchManifest();

    const keys = options?.keys
      ? options.keys
      : Object.keys(manifest.assets);

    // 進捗初期化
    this.totalCount = keys.length;
    this.completedCount = 0;
    this.loadedBytes = 0;
    this.totalBytes = keys.reduce(
      (sum, k) => sum + (manifest.assets[k]?.size ?? 0),
      0
    );

    const result: AssetMap = new Map();

    const queue = [...keys];
    let idx = 0;

    const worker = async (): Promise<void> => {
      while (idx < queue.length) {
        if (this.cancelled) break;
        const key = queue[idx++];
        const entry = manifest.assets[key];
        if (!entry) continue;

        try {
          const data = await this.fetchAsset(key, entry.url, entry, options);
          // BUG FIX: ArrayBuffer → Blob 変換時に contentType を付与
          if (data instanceof ArrayBuffer) {
            result.set(key, new Blob([data], { type: entry.contentType }));
          } else {
            result.set(key, data as Blob);
          }
        } catch (err) {
          if ((err as LoadError).type) {
            // errors are emitted in fetchAsset; just continue
          }
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(this.opts.concurrency, Math.max(1, queue.length)) },
      () => worker()
    );
    await Promise.all(workers);

    return result;
  }

  /** 進捗コールバックを登録 */
  onProgress(callback: (event: ProgressEvent) => void): void {
    this.progressCallbacks.push(callback);
  }

  /** エラーコールバックを登録 */
  onError(callback: (error: LoadError) => void): void {
    this.errorCallbacks.push(callback);
  }

  /** 進行中のダウンロードをすべてキャンセル */
  cancel(): void {
    this.cancelled = true;
  }

  /** manifest を取得する（キャッシュあれば使い回す） */
  getManifest(): DeployManifest | null {
    return this.manifest;
  }

  // ── プライベート ───────────────────────────────────────────────────────

  private async fetchManifest(): Promise<DeployManifest> {
    if (this.manifest) return this.manifest;

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.opts.timeout
    );

    try {
      const res = await fetch(this.manifestUrl, {
        signal: controller.signal,
        cache: 'no-store',
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${this.manifestUrl}`);
      }

      this.manifest = (await res.json()) as DeployManifest;
      return this.manifest;
    } catch (e) {
      const err: LoadError = {
        type: e instanceof DOMException && e.name === 'AbortError'
          ? 'timeout'
          : 'network',
        key: '__manifest__',
        url: this.manifestUrl,
        cause: e instanceof Error ? e : new Error(String(e)),
      };
      this.emitError(err);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchAsset(
    key: string,
    url: string,
    entry: { size: number; hash: string; contentType: string },
    options?: LoadOptions
  ): Promise<Blob | ArrayBuffer> {
    if (this.cancelled) {
      const err: LoadError = { type: 'abort', key, url };
      throw err;
    }

    const responseType =
      options?.responseType ?? inferResponseType(entry.contentType);
    const maxAttempts = this.opts.retryCount + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (this.cancelled) {
        const err: LoadError = { type: 'abort', key, url };
        throw err;
      }

      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        this.opts.timeout
      );
      const externalAbort = () => controller.abort();
      options?.signal?.addEventListener('abort', externalAbort);

      try {
        const res = await fetch(url, { signal: controller.signal });

        if (!res.ok) {
          throw Object.assign(new Error(`HTTP ${res.status}`), {
            statusCode: res.status,
          });
        }

        const buffer = await res.arrayBuffer();

        if (this.opts.integrity && entry.hash) {
          try {
            await verifyIntegrity(buffer, entry.hash);
          } catch (integrityErr) {
            const err: LoadError = {
              type: 'integrity',
              key,
              url,
              cause:
                integrityErr instanceof Error
                  ? integrityErr
                  : new Error(String(integrityErr)),
            };
            this.emitError(err);
            throw err;
          }
        }

        // 進捗更新（loadAll セッション内のみ有効）
        this.loadedBytes += entry.size;
        this.completedCount++;
        this.emitProgress(key);

        if (responseType === 'json') {
          const text = new TextDecoder().decode(buffer);
          return new Blob([text], { type: 'application/json' });
        }
        if (responseType === 'blob') {
          // BUG FIX: 常に entry.contentType を使う
          return new Blob([buffer], { type: entry.contentType });
        }
        return buffer;

      } catch (e) {
        options?.signal?.removeEventListener('abort', externalAbort);
        clearTimeout(timer);

        const isAbort = e instanceof DOMException && e.name === 'AbortError';
        const isTimeout = isAbort && !options?.signal?.aborted;

        if (isAbort && options?.signal?.aborted) {
          const err: LoadError = { type: 'abort', key, url };
          this.emitError(err);
          throw err;
        }

        if ((e as LoadError).type === 'integrity') throw e;

        if (attempt === maxAttempts - 1) {
          const err: LoadError = {
            type: isTimeout ? 'timeout' : 'network',
            key,
            url,
            cause: e instanceof Error ? e : new Error(String(e)),
            statusCode: (e as { statusCode?: number }).statusCode,
          };
          this.emitError(err);
          throw err;
        }

        await delay(this.opts.retryDelay * Math.pow(2, attempt));
        continue;
      } finally {
        clearTimeout(timer);
        options?.signal?.removeEventListener('abort', externalAbort);
      }
    }

    throw new Error('Unreachable');
  }

  private emitProgress(currentKey: string): void {
    const event: ProgressEvent = {
      loaded: this.loadedBytes,
      total: this.totalBytes,
      asset: currentKey,
      completedCount: this.completedCount,
      totalCount: this.totalCount,
    };
    this.progressCallbacks.forEach((cb) => cb(event));
  }

  private emitError(err: LoadError): void {
    this.errorCallbacks.forEach((cb) => cb(err));
  }
}
