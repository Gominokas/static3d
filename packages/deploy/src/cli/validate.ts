import { loadConfig, validateDeployConfig } from '../config/schema.js';
import { collectDeferredAssets } from '../build/collect.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ValidateCommandOptions {
  configPath?: string;
}

export async function validateCommand(
  opts: ValidateCommandOptions = {}
): Promise<void> {
  let hasError = false;

  const log = {
    ok: (msg: string) => console.log(`  ✓ ${msg}`),
    warn: (msg: string) => console.warn(`  ⚠ ${msg}`),
    err: (msg: string) => {
      console.error(`  ✗ ${msg}`);
      hasError = true;
    },
  };

  console.log('[VALIDATE] Checking static3d.config.json...\n');

  // --- config読み込み ---
  let config;
  try {
    config = loadConfig(opts.configPath);
    log.ok('Config file loaded');
  } catch (e) {
    log.err((e as Error).message);
    process.exit(1);
  }

  // --- schemaVersion ---
  if (config.schemaVersion !== 1) {
    log.err(`schemaVersion must be 1, got ${config.schemaVersion}`);
  } else {
    log.ok(`schemaVersion: ${config.schemaVersion}`);
  }

  // --- project名 ---
  if (!config.project) {
    log.err('"project" is required');
  } else {
    log.ok(`project: "${config.project}"`);
  }

  // --- deploy section ---
  if (!config.deploy) {
    log.warn('"deploy" section not present — skipping deploy validation');
  } else {
    let deployConfig;
    try {
      deployConfig = validateDeployConfig(config);
      log.ok('Deploy config valid');
    } catch (e) {
      log.err((e as Error).message);
    }

    if (deployConfig) {
      // CDN baseUrl
      if (deployConfig.cdn.baseUrl.startsWith('https://')) {
        log.ok(`cdn.baseUrl: ${deployConfig.cdn.baseUrl}`);
      } else {
        log.err('cdn.baseUrl must start with https://');
      }

      // ディレクトリ存在確認
      const immDir = resolve(deployConfig.assets.immediateDir);
      const defDir = resolve(deployConfig.assets.deferredDir);

      if (existsSync(immDir)) {
        log.ok(`immediateDir exists: ${deployConfig.assets.immediateDir}`);
      } else {
        log.err(`immediateDir not found: ${deployConfig.assets.immediateDir}`);
      }

      if (existsSync(defDir)) {
        log.ok(`deferredDir exists: ${deployConfig.assets.deferredDir}`);
      } else {
        log.err(`deferredDir not found: ${deployConfig.assets.deferredDir}`);
      }

      // アセット収集（実際にglobして確認）
      if (existsSync(defDir)) {
        try {
          const assets = await collectDeferredAssets(deployConfig);
          log.ok(`Deferred assets: ${assets.length} file(s) found`);

          const gltfCount = assets.filter((a) => a.key.endsWith('.gltf')).length;
          if (gltfCount > 0) {
            log.ok(`  ${gltfCount} .gltf file(s) will be rewritten`);
          }
        } catch (e) {
          log.err(`Asset collection failed: ${(e as Error).message}`);
        }
      }
    }
  }

  // --- 環境変数チェック ---
  console.log('\n[VALIDATE] Checking environment variables...\n');

  const envVars = [
    { name: 'CLOUDFLARE_ACCOUNT_ID', required: true },
    { name: 'CLOUDFLARE_R2_ACCESS_KEY_ID', required: true },
    { name: 'CLOUDFLARE_R2_SECRET_ACCESS_KEY', required: true },
    { name: 'CLOUDFLARE_API_TOKEN', required: true },
  ];

  for (const { name, required } of envVars) {
    if (process.env[name]) {
      log.ok(`${name}: set`);
    } else if (required) {
      log.warn(`${name}: not set (required for "push" command)`);
    }
  }

  // --- 結果 ---
  console.log('');
  if (hasError) {
    console.error('[VALIDATE] ✗ Validation failed — fix errors above');
    process.exit(1);
  } else {
    console.log('[VALIDATE] ✓ All checks passed');
  }
}
