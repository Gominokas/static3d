/**
 * plugin.ts — @static3d/deploy Vite プラグイン
 *
 * 使い方（vite.config.ts）:
 *
 *   import { defineConfig } from 'vite';
 *   import { static3d } from '@static3d/deploy/vite';
 *
 *   export default defineConfig({
 *     plugins: [
 *       static3d({
 *         config: './static3d.config.json',  // 省略時のデフォルト
 *       }),
 *     ],
 *   });
 *
 * dev モード:
 *   - /manifest.json → deferred/ をスキャンして dev 用 manifest を動的生成
 *   - /cdn/*         → deferred/ のファイルをそのまま配信（ハッシュなし）
 *   - ファイル変更を fs.watch で検知して manifest キャッシュを自動無効化
 *
 * build モード:
 *   - closeBundle フックで static3d のアセットパイプラインを自動実行
 *   - deferred assets のハッシュ計算・gltf 書き換え・manifest 生成
 *   - dist/pages/ と dist/cdn/ に出力
 */

import type { Plugin, ViteDevServer } from 'vite';
import { resolve } from 'node:path';
import { loadConfig, validateDeployConfig } from '../config/schema.js';
import { build } from '../build/index.js';
import { registerDevMiddlewares } from './devServer.js';

// ────────────────────────────────────────────────────────────────────────────
// 公開 API
// ────────────────────────────────────────────────────────────────────────────

export interface Static3dPluginOptions {
  /**
   * static3d.config.json へのパス（デフォルト: './static3d.config.json'）
   */
  config?: string;
}

/**
 * static3d Vite プラグイン。
 *
 * dev/build 両モードでのアセットパイプライン統合を提供する。
 */
export function static3d(options?: Static3dPluginOptions): Plugin {
  let deferredDir = resolve('src/assets/deferred'); // デフォルト（フォールバック）
  let ignorePatterns: string[] = [];
  let viteOutDir: string | undefined;
  let isBuild = false;

  return {
    name: 'static3d',

    // ── 設定解決フック ──────────────────────────────────────────────────────
    configResolved(resolvedConfig) {
      isBuild = resolvedConfig.command === 'build';
      viteOutDir = resolvedConfig.build.outDir;

      try {
        const rawConfig = loadConfig(options?.config);
        const deployConfig = validateDeployConfig(rawConfig);
        deferredDir = resolve(deployConfig.assets.deferredDir);
        ignorePatterns = deployConfig.assets.ignore ?? [];
      } catch {
        // config 不完全でも dev は動く（フォールバック値を使用）
        // build 時は closeBundle でエラーになる
      }
    },

    // ── dev server ミドルウェア登録 ────────────────────────────────────────
    configureServer(server: ViteDevServer) {
      registerDevMiddlewares(server, {
        deferredDir,
        ignorePatterns,
      });

      // サーバー起動完了後にログを出力
      server.httpServer?.once('listening', () => {
        console.log(
          '[static3d] Dev server ready — serving /manifest.json and /cdn/*'
        );
      });
    },

    // ── ビルド完了フック ───────────────────────────────────────────────────
    async closeBundle() {
      // dev モードではビルドパイプラインを実行しない
      if (!isBuild) return;

      try {
        const rawConfig = loadConfig(options?.config);
        const deployConfig = validateDeployConfig(rawConfig);
        await build(deployConfig, viteOutDir);

        // ログ用: 生成された manifest から asset 数を読み取る
        let assetCount = 0;
        try {
          const { readFileSync } = await import('node:fs');
          const manifestPath = resolve(
            deployConfig.pages?.outputDir ?? 'dist/pages',
            'manifest.json'
          );
          const m = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
            assets: Record<string, unknown>;
          };
          assetCount = Object.keys(m.assets).length;
        } catch {
          // manifest 読み取り失敗は無視（ログが不完全になるだけ）
        }

        console.log(`[static3d] Build complete — ${assetCount} assets processed`);
      } catch (e) {
        // ビルド失敗は warning に留める（Vite ビルド自体は成功させる）
        this.warn(`[static3d] Asset pipeline failed: ${(e as Error).message}`);
      }
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 後方互換エイリアス（既存コードが static3dDeploy を使っている場合）
// ────────────────────────────────────────────────────────────────────────────

/** @deprecated Use `static3d` instead */
export const static3dDeploy = static3d;

export type { Static3dPluginOptions as Static3dDeployOptions };
