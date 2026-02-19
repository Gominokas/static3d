import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeployConfig } from '@static3d/types';
import { collectDeferredAssets } from './collect.js';
import {
  hashAsset,
  computeHash,
  computeFullHash,
  computeContentDigest,
  getGitShortSha,
} from './hash.js';
import { rewriteGltf } from './gltf.js';
import { generateManifest } from './manifest.js';
import { writeOutput } from './output.js';
import { optimizeAsset } from './optimize.js';
import type { HashedAsset } from './hash.js';
import type { OptimizeConfig } from '../config/optimize-config.js';

export async function build(
  config: DeployConfig,
  viteOutputDir?: string,
  optimizeConfig?: OptimizeConfig
): Promise<void> {
  const hashLength = config.assets.hashLength ?? 8;
  const cdnBaseUrl = config.cdn.baseUrl.replace(/\/$/, '');
  const deferredDir = resolve(config.assets.deferredDir);

  console.log('[BUILD] Collecting assets...');
  const collected = await collectDeferredAssets(config);
  console.log(`[BUILD] Found ${collected.length} deferred assets`);

  // Step 0: GLB / glTF ファイルを最適化（Draco 圧縮 / prune / dedup）
  // hash より前に実行することで、圧縮済みバイナリのハッシュを使う。
  // 最適化済みバッファを一時ファイルに書き出し、収集済みアセットのパスを差し替える。
  const optimizeEnabled = optimizeConfig?.enabled === true;

  if (optimizeEnabled) {
    console.log('[BUILD] Optimizing GLB/glTF assets...');
  }

  // 最適化済みバッファを保持するマップ（key → Buffer）
  // 一時ファイルパスのマップ（key → tempPath）
  const optimizedPaths = new Map<string, string>();

  if (optimizeEnabled) {
    const glbGltfAssets = collected.filter(
      (a) => a.key.endsWith('.glb') || a.key.endsWith('.gltf')
    );

    for (const asset of glbGltfAssets) {
      const { buffer, logLine } = await optimizeAsset(asset.absolutePath, {
        enabled: true,
        draco: optimizeConfig?.draco !== false,
        prune: optimizeConfig?.prune !== false,
        dedup: optimizeConfig?.dedup !== false,
        dracoOptions: optimizeConfig?.dracoOptions,
      });

      console.log(logLine);

      if (buffer !== null) {
        // 一時ファイルに書き出して収集済みアセットのパスを置き換える
        const tmpPath = join(
          tmpdir(),
          `static3d-opt-${Date.now()}-${asset.key.replace(/\//g, '_')}`
        );
        writeFileSync(tmpPath, buffer);
        optimizedPaths.set(asset.key, tmpPath);

        // collected の absolutePath と size を更新
        asset.absolutePath = tmpPath;
        asset.size = buffer.length;
      }
    }
  }

  // Step 1: 非 gltf ファイルのハッシュ計算
  console.log('[BUILD] Hashing non-gltf assets...');
  const hashedMap = new Map<string, HashedAsset>();
  const gltfKeys: string[] = [];

  for (const asset of collected) {
    if (asset.key.endsWith('.gltf')) {
      gltfKeys.push(asset.key);
    } else {
      const hashed = hashAsset(
        asset.key,
        asset.absolutePath,
        asset.size,
        hashLength
      );
      hashedMap.set(asset.key, hashed);
    }
  }

  // Step 2: .gltf の uri 書き換え（依存する bin/texture が先にハッシュ済みであること）
  console.log(`[BUILD] Rewriting ${gltfKeys.length} gltf file(s)...`);
  const rewrittenGltfs = new Map<string, string>();
  const dependencyMap = new Map<string, string[]>();

  for (const gltfKey of gltfKeys) {
    const asset = collected.find((a) => a.key === gltfKey)!;
    const result = rewriteGltf(
      gltfKey,
      asset.absolutePath,
      deferredDir,
      cdnBaseUrl,
      hashedMap
    );
    rewrittenGltfs.set(gltfKey, result.rewrittenContent);
    dependencyMap.set(gltfKey, result.dependencies);

    // 書き換え後の内容でハッシュ計算
    const buffer = Buffer.from(result.rewrittenContent);
    const shortHash = computeHash(buffer, hashLength);
    const fullHash = computeFullHash(buffer);
    const base = gltfKey.replace(/\.gltf$/, '');
    const hashedKey = `${base}.${shortHash}.gltf`;

    hashedMap.set(gltfKey, {
      key: gltfKey,
      absolutePath: asset.absolutePath,
      size: buffer.length,
      hash: `sha256:${fullHash}`,
      hashedFilename: hashedKey.split('/').pop()!,
      hashedKey,
    });
  }

  // Step 3: バージョン生成
  const allFullHashes = Array.from(hashedMap.values()).map((a) => a.hash);
  const gitSha = getGitShortSha();
  const version = gitSha ?? `content:${computeContentDigest(allFullHashes)}`;
  if (!gitSha) {
    console.log('[BUILD] Git not available — version derived from content hash');
  }

  // Step 4: マニフェスト生成
  console.log('[BUILD] Generating manifest...');
  const allHashed = Array.from(hashedMap.values());
  const manifest = generateManifest(
    allHashed,
    cdnBaseUrl,
    version,
    dependencyMap
  );

  // Step 5: 出力
  console.log('[BUILD] Writing output...');
  const pagesOutputDir = config.pages.outputDir ?? 'dist/pages';
  await writeOutput(
    pagesOutputDir,
    config.assets.immediateDir,
    'dist/cdn',
    manifest,
    allHashed,
    rewrittenGltfs,
    viteOutputDir
  );

  const optimizedCount = optimizedPaths.size;
  const optimizeNote = optimizedCount > 0 ? ` (${optimizedCount} optimized)` : '';
  console.log(`[BUILD] Done! ${allHashed.length} assets processed${optimizeNote}`);
  console.log(`[BUILD]   ${pagesOutputDir}/  — Pages deployment ready`);
  console.log(`[BUILD]   dist/cdn/            — CDN deployment ready`);
}
