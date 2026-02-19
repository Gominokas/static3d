/**
 * AssetLoader.ts
 *
 * manifest.json を読み込み、CDN から 3D アセットを fetch するローダー。
 * ブラウザ専用（Node.js の fs / path 等は一切使わない）。
 *
 * 機能:
 *   - manifest.json 取得 & キャッシュ
 *   - 同時ダウンロード数制御（concurrency）
 *   - 指数バックオフ付きリトライ
 *   - タイムアウト（AbortSignal + setTimeout）
 *   - SRI ハッシュ検証（SubtleCrypto、integrity オプション）
 *   - 進捗コールバック（onProgress）
 *   - エラーコールバック（onError）
 *   - 全体キャンセル（cancel）
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

/** "sha256:<hex64>" から SubresourceIntegrity 文字列 "sha256-<base64>" を生成 */
function toSriString(hash: string): string | null {
  // hash は "sha256:<64 hex chars>"
  const m = hash.match(/^sha256:([0-9a-f]{64})$/i);
  if (!m) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(m[1].slice(i * 2, i * 2 + 2), 16);
  }
  // base64 encode
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return 'sha256-' + btoa(bin);
}

/**
 * SubtleCrypto で Blob の SHA-256 を計算し、manifest の hash と照合する。
 * hash 形式: "sha256:<hex64>"
 */
async function verifyIntegrity(data: ArrayBuffer, hash: string): Promise<void> {
  const m = hash.match(/^sha256:([0-9a-f]{64})$/i);
  if (!m) return; // 検証不能な形式はスキップ

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

  /** 進捗トラッキング */
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
   * loadAll / load より先に呼ぶ必要はないが、呼ぶと事前に取得できる。
   */
  async init(): Promise<void> {
    await this.fetchManifest();
  }

  /**
   * 単一アセットを取得する。
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
    const errors: LoadError[] = [];

    // TODO(phase3): 個別アセットに priority を付けて loadAll でソートする。
    // 現状の LoadAllOptions.priority は全エントリに共通の値なので
    // sort しても順番が変わらない（全要素の比較値が同じ）。
    // Phase 3 では AssetEntry に priority フィールドを追加し、
    // high → normal → low の順で処理するキューを実装する予定。
    // ref: https://github.com/Gominokas/static3d/issues (priority queuing)
    const queue = [...keys];

    // concurrency 制御
    let idx = 0;

    const worker = async (): Promise<void> => {
      while (idx < queue.length) {
        if (this.cancelled) break;
        const key = queue[idx++];
        const entry = manifest.assets[key];
        if (!entry) continue;

        try {
          const data = await this.fetchAsset(key, entry.url, entry, options);
          result.set(key, data instanceof ArrayBuffer ? new Blob([data]) : data as Blob);
        } catch (err) {
          if ((err as LoadError).type) {
            errors.push(err as LoadError);
          }
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(this.opts.concurrency, queue.length) },
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
        cache: 'no-store', // manifest は常に最新を取得
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

  /**
   * 単一ファイルをリトライ付きで fetch する。
   * タイムアウト・整合性チェック・進捗通知を行う。
   */
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

      // タイムアウト + 外部 AbortSignal を合成
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        this.opts.timeout
      );
      const externalAbort = () => controller.abort();
      options?.signal?.addEventListener('abort', externalAbort);

      try {
        const res = await fetch(url, {
          signal: controller.signal,
        });

        if (!res.ok) {
          throw Object.assign(new Error(`HTTP ${res.status}`), {
            statusCode: res.status,
          });
        }

        const buffer = await res.arrayBuffer();

        // SRI 整合性チェック
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

        // 進捗更新
        this.loadedBytes += entry.size;
        this.completedCount++;
        this.emitProgress(key);

        // 要求された形式に変換
        if (responseType === 'json') {
          const text = new TextDecoder().decode(buffer);
          return new Blob([text], { type: 'application/json' });
        }
        if (responseType === 'blob') {
          return new Blob([buffer], { type: entry.contentType });
        }
        return buffer; // arraybuffer

      } catch (e) {
        options?.signal?.removeEventListener('abort', externalAbort);
        clearTimeout(timer);

        const isAbort = e instanceof DOMException && e.name === 'AbortError';
        const isTimeout = isAbort && !options?.signal?.aborted;

        // 外部からの abort は即リトライせずスロー
        if (isAbort && options?.signal?.aborted) {
          const err: LoadError = { type: 'abort', key, url };
          this.emitError(err);
          throw err;
        }

        // integrity エラーはリトライしない
        if ((e as LoadError).type === 'integrity') throw e;

        // 最後の試行 → エラーをスロー
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

        // 指数バックオフで待機してリトライ
        await delay(this.opts.retryDelay * Math.pow(2, attempt));
        continue;
      } finally {
        clearTimeout(timer);
        options?.signal?.removeEventListener('abort', externalAbort);
      }
    }

    // ここには到達しないが TypeScript を満足させる
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
