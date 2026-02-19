/**
 * devServer.ts
 *
 * Vite dev server に以下の 2 つのミドルウェアを追加する:
 *
 *  GET /manifest.json
 *    deferred/ ディレクトリをスキャンして dev 用 manifest を動的生成し、
 *    JSON レスポンスとして返す。ファイル変更を検知して次回リクエストで
 *    再生成する（キャッシュを持つがウォッチャーで無効化する）。
 *
 *  GET /cdn/*
 *    deferred/ のファイルをそのまま配信する（ハッシュなし）。
 *    パストラバーサル対策・MIME type 付与あり。
 */

import { resolve, join } from 'node:path';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { watch } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ViteDevServer } from 'vite';

/** connect ミドルウェア関数の型 (@types/connect 不要) */
type NextHandleFunction = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void
) => void;
import { lookup } from 'mime-types';
import { buildDevManifest } from './devManifest.js';

// ────────────────────────────────────────────────────────────────────────────
// 型
// ────────────────────────────────────────────────────────────────────────────

export interface DevServerOptions {
  deferredDir: string;
  ignorePatterns?: string[];
}

// ────────────────────────────────────────────────────────────────────────────
// マニフェスト キャッシュ
// ────────────────────────────────────────────────────────────────────────────

/** JSON 文字列キャッシュ。null のとき次回リクエストで再生成 */
let manifestCache: string | null = null;
let fsWatcher: ReturnType<typeof watch> | null = null;

/** キャッシュを無効化する */
function invalidateCache(): void {
  manifestCache = null;
}

/**
 * deferredDir 以下のファイル変更を監視してキャッシュを自動無効化する。
 * 多重登録しないよう、既存の watcher は先に閉じる。
 */
export function watchDeferredDir(deferredDir: string): void {
  if (fsWatcher) {
    try { fsWatcher.close(); } catch { /* ignore */ }
    fsWatcher = null;
  }
  if (!existsSync(deferredDir)) return;

  try {
    fsWatcher = watch(deferredDir, { recursive: true }, () => {
      invalidateCache();
    });
    // プロセス終了時に watcher をクリーンアップ
    fsWatcher.unref();
  } catch {
    // ディレクトリが存在しない等の場合は無視
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ミドルウェア
// ────────────────────────────────────────────────────────────────────────────

/**
 * /manifest.json を動的に配信するミドルウェアを返す。
 */
export function manifestMiddleware(opts: DevServerOptions): NextHandleFunction {
  const absDeferred = resolve(opts.deferredDir);

  return function handleManifest(
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void
  ): void {
    const url = req.url?.split('?')[0]; // クエリ文字列を除去
    if (url !== '/manifest.json') {
      return next();
    }

    (async () => {
      try {
        // キャッシュヒットならそのまま返す
        if (manifestCache !== null) {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(manifestCache);
          return;
        }

        const manifest = await buildDevManifest(
          absDeferred,
          opts.ignorePatterns
        );
        manifestCache = JSON.stringify(manifest, null, 2);

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(manifestCache);
      } catch (e) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: (e as Error).message }));
      }
    })();
  };
}

/**
 * /cdn/* を deferred/ ディレクトリから配信するミドルウェアを返す。
 */
export function cdnMiddleware(opts: DevServerOptions): NextHandleFunction {
  const absDeferred = resolve(opts.deferredDir);

  return function handleCdn(
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void
  ): void {
    const url = req.url;
    if (!url || !url.startsWith('/cdn/')) {
      return next();
    }

    // "/cdn/" プレフィックスを取り除いてデコード
    const rawPath = url.slice('/cdn/'.length).split('?')[0];
    let decoded: string;
    try {
      decoded = decodeURIComponent(rawPath);
    } catch {
      return next();
    }

    // パストラバーサル対策
    if (decoded.includes('..') || decoded.startsWith('/')) {
      res.statusCode = 400;
      res.end('Bad Request');
      return;
    }

    const filePath = join(absDeferred, decoded);

    // absDeferred の外に出ていないか再チェック（Windows / POSIX 両対応）
    // join() は OS ネイティブのパス区切り文字を使うため、
    // Windows 環境では '\' になる。比較前に '/' に正規化する。
    const normalizedFile = filePath.replace(/\\/g, '/');
    const normalizedBase = absDeferred.replace(/\\/g, '/');
    if (
      !normalizedFile.startsWith(normalizedBase + '/') &&
      normalizedFile !== normalizedBase
    ) {
      res.statusCode = 400;
      res.end('Bad Request');
      return;
    }

    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      return next();
    }

    const contentType = lookup(filePath) || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(readFileSync(filePath));
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Vite dev server 登録ヘルパー
// ────────────────────────────────────────────────────────────────────────────

/**
 * ViteDevServer に static3d のミドルウェアを登録する。
 * plugin.ts の configureServer から呼び出す。
 */
export function registerDevMiddlewares(
  server: ViteDevServer,
  opts: DevServerOptions
): void {
  // ファイル変更監視を開始
  watchDeferredDir(opts.deferredDir);

  // /manifest.json と /cdn/* を Vite の内部ミドルウェアより前に登録
  server.middlewares.use(manifestMiddleware(opts));
  server.middlewares.use(cdnMiddleware(opts));
}
