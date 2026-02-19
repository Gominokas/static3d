import { resolve, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { glob } from 'glob';
import type { DeployConfig } from '@static3d/types';
import type { DeployManifest } from '@static3d/types';
import { resolveR2Credentials, resolvePagesCredentials } from '../config/auth.js';
import { createR2Client, verifyR2Access, uploadToR2 } from './r2.js';
import { deployToPages } from './pages.js';
import { cleanupOldAssets } from './cleanup.js';

export interface PushOptions {
  /** Cloudflare Pages プロジェクト名 (デフォルト: config.project) */
  projectName?: string;
  /** 旧世代クリーンアップをスキップ */
  skipCleanup?: boolean;
  /** Pages デプロイをスキップ (CDNのみ更新) */
  skipPages?: boolean;
}

export async function push(
  config: DeployConfig,
  projectName: string,
  options: PushOptions = {}
): Promise<void> {
  const pagesOutputDir = resolve(config.pages.outputDir ?? 'dist/pages');
  const cdnOutputDir = resolve('dist/cdn');
  const manifestPath = join(pagesOutputDir, 'manifest.json');

  // ---- 前提条件チェック ----
  if (!existsSync(pagesOutputDir)) {
    throw new Error(
      `[PUSH] ${pagesOutputDir} not found. Run "static3d-deploy build" first.`
    );
  }
  if (!existsSync(manifestPath)) {
    throw new Error(
      `[PUSH] manifest.json not found at ${manifestPath}. Run "static3d-deploy build" first.`
    );
  }
  if (!existsSync(cdnOutputDir)) {
    throw new Error(
      `[PUSH] ${cdnOutputDir} not found. Run "static3d-deploy build" first.`
    );
  }

  const manifest: DeployManifest = JSON.parse(
    readFileSync(manifestPath, 'utf-8')
  );

  console.log(`[PUSH] Starting deployment (version: ${manifest.version})`);

  // ---- 認証情報解決 ----
  const r2Creds = resolveR2Credentials();
  const pagesCreds = !options.skipPages ? resolvePagesCredentials() : null;

  // ---- R2 疎通確認 ----
  const s3 = createR2Client(r2Creds);
  console.log(`[PUSH] Verifying R2 access to bucket "${config.cdn.bucket}"...`);
  await verifyR2Access(s3, config.cdn.bucket);
  console.log('[PUSH] R2 access OK');

  // ---- dist/cdn/ 以下のキー一覧収集 ----
  const cdnFiles = await glob('**/*', {
    cwd: cdnOutputDir,
    nodir: true,
  });
  const hashedKeys = cdnFiles.map((f) => f.replace(/\\/g, '/'));

  // ---- R2 差分アップロード ----
  console.log(`[PUSH] Uploading ${hashedKeys.length} CDN asset(s) to R2...`);
  const r2Result = await uploadToR2(
    s3,
    config.cdn.bucket,
    cdnOutputDir,
    hashedKeys,
    (done, total, key) => {
      process.stdout.write(`[R2] (${done + 1}/${total}) ${key}\r`);
    }
  );
  console.log(
    `[PUSH] R2 upload complete: ${r2Result.uploaded} uploaded, ${r2Result.skipped} skipped, ` +
      `${(r2Result.totalBytes / 1024).toFixed(1)}KB total`
  );

  // ---- Pages デプロイ ----
  // 原子性保証: R2アップロード完了後にPagesをデプロイ
  // Pagesがmanifestを配信し始めた時点で全CDNアセットが存在している
  if (!options.skipPages && pagesCreds) {
    const pagesResult = await deployToPages(
      pagesCreds,
      projectName,
      pagesOutputDir
    );
    console.log(`[PUSH] Pages deployed: ${pagesResult.url}`);
  } else {
    console.log('[PUSH] Pages deploy skipped');
  }

  // ---- 旧世代クリーンアップ ----
  if (!options.skipCleanup) {
    const retention = config.oldVersionRetention ?? 0;
    const cleanupResult = await cleanupOldAssets(
      s3,
      config.cdn.bucket,
      manifest,
      config.cdn.baseUrl,
      retention
    );
    if (cleanupResult.deleted.length > 0) {
      console.log(
        `[PUSH] Cleanup: ${cleanupResult.deleted.length} old asset(s) deleted`
      );
    }
  } else {
    console.log('[PUSH] Cleanup skipped');
  }

  console.log(`[PUSH] Done ✓  (version: ${manifest.version})`);
}
