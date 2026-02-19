import type { Plugin, ViteDevServer } from 'vite';
import { resolve, relative } from 'node:path';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { glob } from 'glob';
import { lookup } from 'mime-types';
import { loadConfig, validateDeployConfig } from '../config/schema.js';
import { build } from '../build/index.js';

export interface Static3dDeployOptions {
  /** Path to static3d.config.json (default: ./static3d.config.json) */
  config?: string;
}

export function static3dDeploy(options?: Static3dDeployOptions): Plugin {
  let deferredDir: string;
  let immediateDir: string;
  let viteOutDir: string | undefined;

  return {
    name: 'static3d-deploy',

    configResolved(resolvedConfig) {
      viteOutDir = resolvedConfig.build.outDir;
      try {
        const config = loadConfig(options?.config);
        const deployConfig = validateDeployConfig(config);
        deferredDir = resolve(deployConfig.assets.deferredDir);
        immediateDir = resolve(deployConfig.assets.immediateDir);
      } catch {
        // dev 時は config 不完全でもフォールバック
        deferredDir = resolve('src/assets/deferred');
        immediateDir = resolve('src/assets/immediate');
      }
    },

    // 開発時: /cdn/* で deferred assets をローカル配信
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/cdn', (req, res, next) => {
        if (!req.url) return next();
        // URL デコード + パストラバーサル対策
        const decoded = decodeURIComponent(req.url.slice(1));
        if (decoded.includes('..')) return next();
        const filePath = resolve(deferredDir, decoded);

        if (!existsSync(filePath) || !statSync(filePath).isFile()) {
          return next();
        }

        const contentType = lookup(filePath) || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(readFileSync(filePath));
      });

      // /manifest.json でローカル用簡易マニフェスト配信
      server.middlewares.use('/manifest.json', async (_req, res) => {
        try {
          const files = await glob('**/*', {
            cwd: deferredDir,
            nodir: true,
          });

          const assets: Record<string, object> = {};
          for (const file of files) {
            const abs = resolve(deferredDir, file);
            const stat = statSync(abs);
            const key = file.replace(/\\/g, '/');
            assets[key] = {
              url: `/cdn/${key}`,
              size: stat.size,
              hash: 'dev',
              contentType: lookup(key) || 'application/octet-stream',
            };
          }

          const manifest = {
            schemaVersion: 1,
            version: 'dev',
            buildTime: new Date().toISOString(),
            assets,
          };

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(manifest, null, 2));
        } catch (e) {
          res.statusCode = 500;
          res.end(`{"error": "${(e as Error).message}"}`);
        }
      });
    },

    // ビルド時: Vite ビルド完了後にアセットパイプライン実行
    async closeBundle() {
      try {
        const config = loadConfig(options?.config);
        const deployConfig = validateDeployConfig(config);
        await build(deployConfig, viteOutDir);
      } catch (e) {
        // ビルド失敗はwarningに留める（Viteビルド自体は成功させる）
        console.warn('[static3d-deploy] Asset pipeline skipped:', (e as Error).message);
      }
    },
  };
}
