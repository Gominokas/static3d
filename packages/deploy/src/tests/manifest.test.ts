import { describe, it, expect } from 'vitest';
import { generateManifest } from '../build/manifest.js';
import type { HashedAsset } from '../build/hash.js';

describe('manifest', () => {
  const dummyAssets: HashedAsset[] = [
    {
      key: 'models/scene.gltf',
      absolutePath: '/tmp/scene.gltf',
      size: 1024,
      hash: 'sha256:' + 'a'.repeat(64),
      hashedFilename: 'scene.abcd1234.gltf',
      hashedKey: 'models/scene.abcd1234.gltf',
    },
    {
      key: 'textures/albedo.png',
      absolutePath: '/tmp/albedo.png',
      size: 2048,
      hash: 'sha256:' + 'b'.repeat(64),
      hashedFilename: 'albedo.efgh5678.png',
      hashedKey: 'textures/albedo.efgh5678.png',
    },
  ];

  it('generates correct manifest structure', () => {
    const depMap = new Map([['models/scene.gltf', ['textures/albedo.png']]]);
    const manifest = generateManifest(
      dummyAssets,
      'https://cdn.example.com',
      'abc1234',
      depMap
    );

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.version).toBe('abc1234');
    expect(manifest.buildTime).toBeTruthy();
    expect(Object.keys(manifest.assets)).toHaveLength(2);
  });

  it('sets correct CDN URLs', () => {
    const manifest = generateManifest(
      dummyAssets,
      'https://cdn.example.com',
      'v1',
      new Map()
    );

    expect(manifest.assets['models/scene.gltf'].url).toBe(
      'https://cdn.example.com/models/scene.abcd1234.gltf'
    );
    expect(manifest.assets['textures/albedo.png'].url).toBe(
      'https://cdn.example.com/textures/albedo.efgh5678.png'
    );
  });

  it('includes dependencies when present', () => {
    const depMap = new Map([['models/scene.gltf', ['textures/albedo.png']]]);
    const manifest = generateManifest(
      dummyAssets,
      'https://cdn.example.com',
      'v1',
      depMap
    );

    expect(manifest.assets['models/scene.gltf'].dependencies).toEqual([
      'textures/albedo.png',
    ]);
    expect(manifest.assets['textures/albedo.png'].dependencies).toBeUndefined();
  });

  it('assigns correct contentType', () => {
    const manifest = generateManifest(
      dummyAssets,
      'https://cdn.example.com',
      'v1',
      new Map()
    );

    expect(manifest.assets['textures/albedo.png'].contentType).toBe('image/png');
    expect(manifest.assets['models/scene.gltf'].contentType).toBe('model/gltf+json');
  });
});
