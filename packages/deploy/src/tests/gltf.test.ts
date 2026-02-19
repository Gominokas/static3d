import { describe, it, expect } from 'vitest';
import { rewriteGltf } from '../build/gltf.js';
import {
  writeFileSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HashedAsset } from '../build/hash.js';

describe('gltf', () => {
  it('rewrites uri fields with CDN URLs', () => {
    const dir = join(tmpdir(), `static3d-gltf-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });

    const gltfContent = JSON.stringify({
      asset: { version: '2.0' },
      buffers: [{ uri: 'model.bin', byteLength: 100 }],
      images: [{ uri: 'texture.png' }],
    });

    writeFileSync(join(dir, 'scene.gltf'), gltfContent);
    writeFileSync(join(dir, 'model.bin'), 'binary data');
    writeFileSync(join(dir, 'texture.png'), 'png data');

    const hashedAssets = new Map<string, HashedAsset>([
      [
        'model.bin',
        {
          key: 'model.bin',
          absolutePath: join(dir, 'model.bin'),
          size: 11,
          hash: 'sha256:abc',
          hashedFilename: 'model.deadbeef.bin',
          hashedKey: 'model.deadbeef.bin',
        },
      ],
      [
        'texture.png',
        {
          key: 'texture.png',
          absolutePath: join(dir, 'texture.png'),
          size: 8,
          hash: 'sha256:def',
          hashedFilename: 'texture.cafebabe.png',
          hashedKey: 'texture.cafebabe.png',
        },
      ],
    ]);

    const result = rewriteGltf(
      'scene.gltf',
      join(dir, 'scene.gltf'),
      dir,
      'https://cdn.example.com',
      hashedAssets
    );

    const rewritten = JSON.parse(result.rewrittenContent);
    expect(rewritten.buffers[0].uri).toBe(
      'https://cdn.example.com/model.deadbeef.bin'
    );
    expect(rewritten.images[0].uri).toBe(
      'https://cdn.example.com/texture.cafebabe.png'
    );
    expect(result.dependencies).toContain('model.bin');
    expect(result.dependencies).toContain('texture.png');

    rmSync(dir, { recursive: true });
  });

  it('skips data: and https: URIs', () => {
    const dir = join(tmpdir(), `static3d-gltf-data-${Date.now()}`);
    mkdirSync(dir, { recursive: true });

    const gltfContent = JSON.stringify({
      asset: { version: '2.0' },
      buffers: [{ uri: 'data:application/octet-stream;base64,AAAA', byteLength: 3 }],
      images: [{ uri: 'https://external.example.com/img.png' }],
    });

    writeFileSync(join(dir, 'embedded.gltf'), gltfContent);

    const result = rewriteGltf(
      'embedded.gltf',
      join(dir, 'embedded.gltf'),
      dir,
      'https://cdn.example.com',
      new Map()
    );

    const rewritten = JSON.parse(result.rewrittenContent);
    // data: と https: は書き換えされない
    expect(rewritten.buffers[0].uri).toMatch(/^data:/);
    expect(rewritten.images[0].uri).toBe('https://external.example.com/img.png');
    expect(result.dependencies).toHaveLength(0);

    rmSync(dir, { recursive: true });
  });

  it('throws when referenced file is not in deferred dir', () => {
    const dir = join(tmpdir(), `static3d-gltf-err-${Date.now()}`);
    mkdirSync(dir, { recursive: true });

    const gltfContent = JSON.stringify({
      asset: { version: '2.0' },
      buffers: [{ uri: 'missing.bin', byteLength: 10 }],
    });

    writeFileSync(join(dir, 'broken.gltf'), gltfContent);

    expect(() =>
      rewriteGltf(
        'broken.gltf',
        join(dir, 'broken.gltf'),
        dir,
        'https://cdn.example.com',
        new Map()
      )
    ).toThrow('[GLTF]');

    rmSync(dir, { recursive: true });
  });
});
