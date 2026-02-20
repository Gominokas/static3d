/**
 * AssetLoader.test.ts — @static3d/loader unit tests
 *
 * Tests the framework-agnostic AssetLoader.
 * Uses happy-dom environment (from vitest.config.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AssetLoader } from '../AssetLoader.js';

// ────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ────────────────────────────────────────────────────────────────────────────

const MANIFEST_URL = '/manifest.json';

function makeManifest(assets: Record<string, { url: string; size: number; hash: string; contentType: string }>) {
  return {
    schemaVersion: 1,
    version: 'v1',
    buildTime: new Date().toISOString(),
    assets,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 1. constructor / init
// ────────────────────────────────────────────────────────────────────────────

describe('AssetLoader — init', () => {
  it('getManifest() returns null before init', () => {
    const loader = new AssetLoader(MANIFEST_URL);
    expect(loader.getManifest()).toBeNull();
  });

  it('init() fetches and caches manifest', async () => {
    const manifest = makeManifest({});
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => manifest,
    } as Response);

    const loader = new AssetLoader(MANIFEST_URL);
    await loader.init();
    expect(loader.getManifest()).toEqual(manifest);
  });

  it('init() throws LoadError on network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'));

    const loader = new AssetLoader(MANIFEST_URL);
    await expect(loader.init()).rejects.toMatchObject({ type: 'network' });
  });

  it('init() throws LoadError on HTTP error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    const loader = new AssetLoader(MANIFEST_URL);
    await expect(loader.init()).rejects.toMatchObject({ type: 'network' });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. load() — single asset
// ────────────────────────────────────────────────────────────────────────────

describe('AssetLoader — load()', () => {
  const manifest = makeManifest({
    'scene.glb': {
      url: 'https://cdn.example.com/scene.abc12345.glb',
      size: 1024,
      hash: 'sha256:' + 'a'.repeat(64),
      contentType: 'model/gltf-binary',
    },
  });

  beforeEach(() => {
    // Reset fetch mock
    globalThis.fetch = vi.fn();
  });

  it('throws not-found for unknown key', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: async () => manifest } as Response);

    const loader = new AssetLoader(MANIFEST_URL);
    await expect(loader.load('missing.glb')).rejects.toMatchObject({
      type: 'not-found',
      key: 'missing.glb',
    });
  });

  it('returns ArrayBuffer for binary contentType', async () => {
    const glbBytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46]).buffer; // "glTF"
    const realHash = await computeSha256Hex(glbBytes);

    const manifestWithRealHash = makeManifest({
      'scene.glb': {
        url: 'https://cdn.example.com/scene.glb',
        size: 4,
        hash: `sha256:${realHash}`,
        contentType: 'model/gltf-binary',
      },
    });

    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: async () => manifestWithRealHash } as Response)
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => glbBytes } as unknown as Response);

    const loader = new AssetLoader(MANIFEST_URL, { integrity: false });
    const result = await loader.load('scene.glb');
    expect(result).toBeInstanceOf(ArrayBuffer);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. loadAll() — BUG FIX: Blob gets contentType
// ────────────────────────────────────────────────────────────────────────────

describe('AssetLoader — loadAll() Blob contentType fix', () => {
  it('Blob in AssetMap has correct contentType (not empty)', async () => {
    const glbBytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46]).buffer;
    const manifest = makeManifest({
      'model.glb': {
        url: 'https://cdn.example.com/model.glb',
        size: 4,
        hash: 'sha256:' + 'b'.repeat(64),
        contentType: 'model/gltf-binary',
      },
    });

    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: async () => manifest } as Response)
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => glbBytes } as unknown as Response);

    const loader = new AssetLoader(MANIFEST_URL, { integrity: false });
    const map = await loader.loadAll();

    const blob = map.get('model.glb');
    expect(blob).toBeDefined();
    expect(blob).toBeInstanceOf(Blob);
    // BUG FIX verification: type should be set, not empty string
    expect(blob!.type).toBe('model/gltf-binary');
  });

  it('returns all requested assets', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const manifest = makeManifest({
      'a.glb': { url: '/a.glb', size: 4, hash: 'sha256:' + 'a'.repeat(64), contentType: 'model/gltf-binary' },
      'b.glb': { url: '/b.glb', size: 4, hash: 'sha256:' + 'b'.repeat(64), contentType: 'model/gltf-binary' },
    });

    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: async () => manifest } as Response)
      .mockResolvedValue({ ok: true, arrayBuffer: async () => bytes } as unknown as Response);

    const loader = new AssetLoader(MANIFEST_URL, { integrity: false });
    const map = await loader.loadAll();
    expect(map.size).toBe(2);
    expect(map.has('a.glb')).toBe(true);
    expect(map.has('b.glb')).toBe(true);
  });

  it('keys option filters assets', async () => {
    const bytes = new Uint8Array([1, 2]).buffer;
    const manifest = makeManifest({
      'a.glb': { url: '/a.glb', size: 2, hash: 'sha256:' + 'a'.repeat(64), contentType: 'model/gltf-binary' },
      'b.glb': { url: '/b.glb', size: 2, hash: 'sha256:' + 'b'.repeat(64), contentType: 'model/gltf-binary' },
    });

    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: async () => manifest } as Response)
      .mockResolvedValue({ ok: true, arrayBuffer: async () => bytes } as unknown as Response);

    const loader = new AssetLoader(MANIFEST_URL, { integrity: false });
    const map = await loader.loadAll({ keys: ['a.glb'] });
    expect(map.size).toBe(1);
    expect(map.has('a.glb')).toBe(true);
    expect(map.has('b.glb')).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. loadAll() — counter not reset by subsequent load()
// ────────────────────────────────────────────────────────────────────────────

describe('AssetLoader — loadAll progress counter not reset by load()', () => {
  it('progress events are emitted during loadAll', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const manifest = makeManifest({
      'a.glb': { url: '/a.glb', size: 4, hash: 'sha256:' + 'a'.repeat(64), contentType: 'model/gltf-binary' },
    });

    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: async () => manifest } as Response)
      .mockResolvedValue({ ok: true, arrayBuffer: async () => bytes } as unknown as Response);

    const loader = new AssetLoader(MANIFEST_URL, { integrity: false });
    const events: { completedCount: number; totalCount: number }[] = [];
    loader.onProgress((e) => events.push({ completedCount: e.completedCount, totalCount: e.totalCount }));

    await loader.loadAll();
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1].completedCount).toBe(1);
    expect(events[events.length - 1].totalCount).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 5. cancel()
// ────────────────────────────────────────────────────────────────────────────

describe('AssetLoader — cancel()', () => {
  it('cancel() sets cancelled flag, subsequent load throws abort', async () => {
    const manifest = makeManifest({
      'a.glb': { url: '/a.glb', size: 4, hash: 'sha256:' + 'a'.repeat(64), contentType: 'model/gltf-binary' },
    });

    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: async () => manifest } as Response);

    const loader = new AssetLoader(MANIFEST_URL, { integrity: false });
    await loader.init();
    loader.cancel();

    await expect(loader.load('a.glb')).rejects.toMatchObject({ type: 'abort' });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 6. onError callback
// ────────────────────────────────────────────────────────────────────────────

describe('AssetLoader — onError()', () => {
  it('calls error callbacks on not-found', async () => {
    const manifest = makeManifest({});

    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: async () => manifest } as Response);

    const loader = new AssetLoader(MANIFEST_URL);
    const errors: unknown[] = [];
    loader.onError((e) => errors.push(e));

    await expect(loader.load('missing.glb')).rejects.toBeDefined();
    expect(errors.length).toBe(1);
    expect((errors[0] as { type: string }).type).toBe('not-found');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Helper: compute real SHA-256 hex
// ────────────────────────────────────────────────────────────────────────────

async function computeSha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
