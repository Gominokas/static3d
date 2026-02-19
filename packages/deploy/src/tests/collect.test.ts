import { describe, it, expect } from 'vitest';
import { collectDeferredAssets } from '../build/collect.js';
import {
  writeFileSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { DeployConfig } from '@static3d/types';

function makeConfig(deferredDir: string): DeployConfig {
  return {
    pages: { outputDir: 'dist/pages' },
    cdn: {
      provider: 'cloudflare-r2',
      bucket: 'test',
      baseUrl: 'https://cdn.example.com',
    },
    assets: {
      immediateDir: deferredDir, // 使わないが必須フィールド
      deferredDir,
    },
  };
}

describe('collect', () => {
  it('collects files recursively', async () => {
    const dir = join(tmpdir(), `static3d-collect-${Date.now()}`);
    mkdirSync(join(dir, 'models'), { recursive: true });
    mkdirSync(join(dir, 'textures'), { recursive: true });
    writeFileSync(join(dir, 'models', 'scene.gltf'), '{}');
    writeFileSync(join(dir, 'textures', 'albedo.png'), 'PNG');
    writeFileSync(join(dir, 'README.txt'), 'readme');

    const assets = await collectDeferredAssets(makeConfig(dir));
    const keys = assets.map((a) => a.key).sort();
    expect(keys).toContain('models/scene.gltf');
    expect(keys).toContain('textures/albedo.png');
    expect(keys).toContain('README.txt');

    rmSync(dir, { recursive: true });
  });

  it('respects ignore patterns', async () => {
    const dir = join(tmpdir(), `static3d-ignore-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'model.glb'), 'glb');
    writeFileSync(join(dir, 'design.psd'), 'psd');
    writeFileSync(join(dir, '.DS_Store'), 'ds');

    const config: DeployConfig = {
      ...makeConfig(dir),
      assets: {
        ...makeConfig(dir).assets,
        ignore: ['**/*.psd', '**/.DS_Store'],
      },
    };

    const assets = await collectDeferredAssets(config);
    const keys = assets.map((a) => a.key);
    expect(keys).toContain('model.glb');
    expect(keys).not.toContain('design.psd');
    expect(keys).not.toContain('.DS_Store');

    rmSync(dir, { recursive: true });
  });

  it('throws on file exceeding maxFileSize', async () => {
    const dir = join(tmpdir(), `static3d-size-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    // 2MB のファイルを作成
    writeFileSync(join(dir, 'big.bin'), Buffer.alloc(2 * 1024 * 1024));

    const config: DeployConfig = {
      ...makeConfig(dir),
      assets: {
        ...makeConfig(dir).assets,
        maxFileSize: '1MB',
      },
    };

    await expect(collectDeferredAssets(config)).rejects.toThrow('[ASSET]');

    rmSync(dir, { recursive: true });
  });
});
