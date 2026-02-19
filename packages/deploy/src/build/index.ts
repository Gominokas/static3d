import { resolve } from 'node:path';
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
import type { HashedAsset } from './hash.js';

export async function build(
  config: DeployConfig,
  viteOutputDir?: string
): Promise<void> {
  const hashLength = config.assets.hashLength ?? 8;
  const cdnBaseUrl = config.cdn.baseUrl.replace(/\/$/, '');
  const deferredDir = resolve(config.assets.deferredDir);

  console.log('[BUILD] Collecting assets...');
  const collected = await collectDeferredAssets(config);
  console.log(`[BUILD] Found ${collected.length} deferred assets`);

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
  // Git が使える → "<short-sha>" （例: "abc1234"）
  // Git 未初期化  → "content:<digest12>"（全アセットhashのダイジェスト）
  // 同じソースセットからは Git 有無に関わらず決定論的な値が得られる。
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

  console.log(`[BUILD] Done! ${allHashed.length} assets processed`);
  console.log(`[BUILD]   ${pagesOutputDir}/  — Pages deployment ready`);
  console.log(`[BUILD]   dist/cdn/            — CDN deployment ready`);
}
