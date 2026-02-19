import {
  mkdirSync,
  copyFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { glob } from 'glob';
import type { DeployManifest } from '@static3d/types';
import type { HashedAsset } from './hash.js';

export async function writeOutput(
  pagesOutputDir: string,
  immediateDir: string,
  cdnOutputDir: string,
  manifest: DeployManifest,
  hashedAssets: HashedAsset[],
  rewrittenGltfs: Map<string, string>,
  viteOutputDir?: string
): Promise<void> {
  const pagesDir = resolve(pagesOutputDir);
  const cdnDir = resolve(cdnOutputDir);

  // dist/pages / dist/cdn を作成
  mkdirSync(pagesDir, { recursive: true });
  mkdirSync(cdnDir, { recursive: true });

  // Viteの出力があればコピー
  if (viteOutputDir && existsSync(viteOutputDir)) {
    const viteFiles = await glob('**/*', {
      cwd: resolve(viteOutputDir),
      nodir: true,
      absolute: true,
    });
    for (const file of viteFiles) {
      const rel = relative(resolve(viteOutputDir), file);
      const dest = join(pagesDir, rel);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(file, dest);
    }
  }

  // immediate assets を pages にコピー
  if (existsSync(resolve(immediateDir))) {
    const immediateFiles = await glob('**/*', {
      cwd: resolve(immediateDir),
      nodir: true,
      absolute: true,
    });
    for (const file of immediateFiles) {
      const rel = relative(resolve(immediateDir), file);
      const dest = join(pagesDir, 'assets', rel);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(file, dest);
    }
  }

  // manifest.json を pages に書き込み
  writeFileSync(
    join(pagesDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  // _headers を pages に書き込み（manifest の Cache-Control）
  writeFileSync(
    join(pagesDir, '_headers'),
    `/manifest.json\n  Cache-Control: public, max-age=0, must-revalidate\n`
  );

  // deferred assets を cdn に出力
  for (const asset of hashedAssets) {
    const destPath = join(cdnDir, asset.hashedKey);
    mkdirSync(dirname(destPath), { recursive: true });

    // gltf の場合は書き換え済み内容を使用
    const rewritten = rewrittenGltfs.get(asset.key);
    if (rewritten) {
      writeFileSync(destPath, rewritten);
    } else {
      copyFileSync(asset.absolutePath, destPath);
    }
  }
}
