import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildDevManifest, parseGltfDependencies } from '../vite/devManifest.js';

// ────────────────────────────────────────────────────────────────────────────
// fixtures
// ────────────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `static3d-devmanifest-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(tmpDir, 'textures'), { recursive: true });
  mkdirSync(join(tmpDir, 'models'), { recursive: true });
  writeFileSync(join(tmpDir, 'textures', 'albedo.png'), 'PNG_DATA');
  writeFileSync(join(tmpDir, 'textures', 'normal.png'), 'PNG_NORM');
  writeFileSync(join(tmpDir, 'models', 'scene.bin'), 'BIN_DATA');
  writeFileSync(
    join(tmpDir, 'models', 'scene.gltf'),
    JSON.stringify({
      buffers: [{ uri: 'scene.bin' }],
      images: [{ uri: '../textures/albedo.png' }],
    })
  );
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ────────────────────────────────────────────────────────────────────────────
// buildDevManifest
// ────────────────────────────────────────────────────────────────────────────

describe('buildDevManifest', () => {
  it('returns schemaVersion 1, version "dev"', async () => {
    const manifest = await buildDevManifest(tmpDir);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.version).toBe('dev');
  });

  it('sets buildTime to an ISO string', async () => {
    const manifest = await buildDevManifest(tmpDir);
    expect(() => new Date(manifest.buildTime)).not.toThrow();
    expect(manifest.buildTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('generates entries for all files', async () => {
    const manifest = await buildDevManifest(tmpDir);
    const keys = Object.keys(manifest.assets).sort();
    expect(keys).toContain('textures/albedo.png');
    expect(keys).toContain('textures/normal.png');
    expect(keys).toContain('models/scene.bin');
    expect(keys).toContain('models/scene.gltf');
  });

  it('sets url to /cdn/<key>', async () => {
    const manifest = await buildDevManifest(tmpDir);
    expect(manifest.assets['textures/albedo.png'].url).toBe('/cdn/textures/albedo.png');
    expect(manifest.assets['models/scene.gltf'].url).toBe('/cdn/models/scene.gltf');
  });

  it('sets hash to empty string (integrity skip in dev)', async () => {
    const manifest = await buildDevManifest(tmpDir);
    for (const entry of Object.values(manifest.assets)) {
      expect(entry.hash).toBe('');
    }
  });

  it('sets correct contentType via mime-types', async () => {
    const manifest = await buildDevManifest(tmpDir);
    expect(manifest.assets['textures/albedo.png'].contentType).toBe('image/png');
    expect(manifest.assets['models/scene.bin'].contentType).toBe('application/octet-stream');
    expect(manifest.assets['models/scene.gltf'].contentType).toContain('gltf');
  });

  it('sets size in bytes', async () => {
    const manifest = await buildDevManifest(tmpDir);
    expect(manifest.assets['textures/albedo.png'].size).toBe(8); // "PNG_DATA"
    expect(manifest.assets['models/scene.bin'].size).toBe(8);    // "BIN_DATA"
  });

  it('adds dependencies for .gltf files', async () => {
    const manifest = await buildDevManifest(tmpDir);
    const gltfEntry = manifest.assets['models/scene.gltf'];
    expect(gltfEntry.dependencies).toBeDefined();
    expect(gltfEntry.dependencies).toContain('models/scene.bin');
    expect(gltfEntry.dependencies).toContain('textures/albedo.png');
  });

  it('does not add dependencies field for non-gltf files', async () => {
    const manifest = await buildDevManifest(tmpDir);
    expect(manifest.assets['textures/albedo.png'].dependencies).toBeUndefined();
    expect(manifest.assets['models/scene.bin'].dependencies).toBeUndefined();
  });

  it('respects ignorePatterns', async () => {
    writeFileSync(join(tmpDir, 'design.psd'), 'PSD');
    const manifest = await buildDevManifest(tmpDir, ['**/*.psd']);
    expect(Object.keys(manifest.assets)).not.toContain('design.psd');
  });

  it('returns empty assets for empty directory', async () => {
    const emptyDir = join(tmpdir(), `static3d-empty-${Date.now()}`);
    mkdirSync(emptyDir, { recursive: true });
    try {
      const manifest = await buildDevManifest(emptyDir);
      expect(Object.keys(manifest.assets)).toHaveLength(0);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('handles data: URI buffers without adding them as dependencies', async () => {
    writeFileSync(
      join(tmpDir, 'models', 'embedded.gltf'),
      JSON.stringify({
        buffers: [{ uri: 'data:application/octet-stream;base64,AAAA' }],
        images: [],
      })
    );
    const manifest = await buildDevManifest(tmpDir);
    const embedded = manifest.assets['models/embedded.gltf'];
    // data: URI は依存として含まれない
    if (embedded.dependencies) {
      expect(embedded.dependencies.some((d) => d.startsWith('data:'))).toBe(false);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// parseGltfDependencies
// ────────────────────────────────────────────────────────────────────────────

describe('parseGltfDependencies', () => {
  it('returns buffer and image URIs as deferredDir-relative keys', () => {
    const gltfPath = join(tmpDir, 'models', 'scene.gltf');
    const deps = parseGltfDependencies(gltfPath, tmpDir);
    expect(deps).toContain('models/scene.bin');
    expect(deps).toContain('textures/albedo.png');
  });

  it('returns empty array for invalid JSON', () => {
    const badPath = join(tmpDir, 'bad.gltf');
    writeFileSync(badPath, 'NOT JSON');
    expect(parseGltfDependencies(badPath, tmpDir)).toEqual([]);
  });

  it('returns empty array for missing file', () => {
    expect(parseGltfDependencies('/nonexistent/file.gltf', tmpDir)).toEqual([]);
  });

  it('ignores data: URI buffers', () => {
    const p = join(tmpDir, 'models', 'inline.gltf');
    writeFileSync(
      p,
      JSON.stringify({ buffers: [{ uri: 'data:application/octet-stream;base64,AA==' }] })
    );
    const deps = parseGltfDependencies(p, tmpDir);
    expect(deps).toHaveLength(0);
  });

  it('handles gltf with no buffers or images', () => {
    const p = join(tmpDir, 'models', 'empty.gltf');
    writeFileSync(p, JSON.stringify({ asset: { version: '2.0' } }));
    expect(parseGltfDependencies(p, tmpDir)).toEqual([]);
  });
});
