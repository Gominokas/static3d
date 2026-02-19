/**
 * AssetLoader.test.ts
 *
 * AssetLoader の単体テスト。
 * fetch を vi.stubGlobal でモックし、実ネットワークを使わない。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AssetLoader } from '../loader/AssetLoader.js';
import type { DeployManifest } from '@static3d/types';

// ────────────────────────────────────────────────────────────────────────────
// テスト用マニフェスト
// ────────────────────────────────────────────────────────────────────────────

const MANIFEST_URL = 'https://pages.example.com/manifest.json';

const MOCK_MANIFEST: DeployManifest = {
  schemaVersion: 1,
  version: 'abc1234',
  buildTime: '2026-01-01T00:00:00.000Z',
  assets: {
    'textures/albedo.png': {
      url: 'https://cdn.example.com/textures/albedo.8cbce19e.png',
      size: 1024,
      hash: 'sha256:' + 'a'.repeat(64),
      contentType: 'image/png',
    },
    'models/scene.gltf': {
      url: 'https://cdn.example.com/models/scene.2073f5d5.gltf',
      size: 2048,
      hash: 'sha256:' + 'b'.repeat(64),
      contentType: 'model/gltf+json',
      dependencies: ['textures/albedo.png'],
    },
  },
};

// ────────────────────────────────────────────────────────────────────────────
// fetch モックユーティリティ
// ────────────────────────────────────────────────────────────────────────────

function makeManifestFetch(manifest: DeployManifest = MOCK_MANIFEST) {
  return (url: string): Promise<Response> => {
    if (url === MANIFEST_URL) {
      return Promise.resolve(
        new Response(JSON.stringify(manifest), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }
    // アセット URL → PNG バイナリ相当
    return Promise.resolve(
      new Response(new Uint8Array(8).buffer, {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      })
    );
  };
}

// ────────────────────────────────────────────────────────────────────────────
// tests
// ────────────────────────────────────────────────────────────────────────────

describe('AssetLoader', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(makeManifestFetch()));
    // crypto.subtle.digest をスタブ（Node 環境では動作するが念のため）
    vi.stubGlobal('crypto', {
      subtle: {
        digest: vi.fn().mockResolvedValue(
          new Uint8Array(32).fill(0xaa).buffer
        ),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── init / manifest 取得 ───────────────────────────────────────────────

  it('init() fetches and caches the manifest', async () => {
    const loader = new AssetLoader(MANIFEST_URL);
    await loader.init();

    expect(fetch).toHaveBeenCalledWith(
      MANIFEST_URL,
      expect.objectContaining({ cache: 'no-store' })
    );
    expect(loader.getManifest()).toMatchObject({
      schemaVersion: 1,
      version: 'abc1234',
    });
  });

  it('init() does not fetch twice (caches manifest)', async () => {
    const loader = new AssetLoader(MANIFEST_URL);
    await loader.init();
    await loader.init();

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  // ── load ──────────────────────────────────────────────────────────────

  it('load() returns ArrayBuffer for binary asset', async () => {
    const loader = new AssetLoader(MANIFEST_URL, { integrity: false });
    const result = await loader.load('textures/albedo.png', {
      responseType: 'arraybuffer',
    });

    expect(result).toBeInstanceOf(ArrayBuffer);
  });

  it('load() returns Blob for blob responseType', async () => {
    const loader = new AssetLoader(MANIFEST_URL, { integrity: false });
    const result = await loader.load('textures/albedo.png', {
      responseType: 'blob',
    });

    expect(result).toBeInstanceOf(Blob);
  });

  it('load() throws LoadError for unknown key', async () => {
    const loader = new AssetLoader(MANIFEST_URL, { integrity: false });
    await expect(loader.load('nonexistent/file.png')).rejects.toMatchObject({
      type: 'not-found',
      key: 'nonexistent/file.png',
    });
  });

  // ── loadAll ───────────────────────────────────────────────────────────

  it('loadAll() returns a Map with all assets', async () => {
    const loader = new AssetLoader(MANIFEST_URL, { integrity: false });
    const result = await loader.loadAll();

    expect(result.size).toBe(2);
    expect(result.has('textures/albedo.png')).toBe(true);
    expect(result.has('models/scene.gltf')).toBe(true);
  });

  it('loadAll({ keys }) returns only requested keys', async () => {
    const loader = new AssetLoader(MANIFEST_URL, { integrity: false });
    const result = await loader.loadAll({ keys: ['textures/albedo.png'] });

    expect(result.size).toBe(1);
    expect(result.has('textures/albedo.png')).toBe(true);
  });

  // ── progress ──────────────────────────────────────────────────────────

  it('onProgress callback is called for each asset', async () => {
    const loader = new AssetLoader(MANIFEST_URL, { integrity: false });
    const events: string[] = [];

    loader.onProgress((e) => {
      events.push(e.asset);
    });

    await loader.loadAll();
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((k) => k.includes('albedo') || k.includes('scene'))).toBe(true);
  });

  // ── onError callback ──────────────────────────────────────────────────

  it('onError callback is called on network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === MANIFEST_URL) {
          return Promise.resolve(
            new Response(JSON.stringify(MOCK_MANIFEST), { status: 200 })
          );
        }
        return Promise.resolve(new Response('Not Found', { status: 404 }));
      })
    );

    const loader = new AssetLoader(MANIFEST_URL, {
      integrity: false,
      retryCount: 0,
    });
    const errors: string[] = [];
    loader.onError((e) => errors.push(e.type));

    try {
      await loader.load('textures/albedo.png');
    } catch {
      // expected
    }

    expect(errors).toContain('network');
  });

  // ── cancel ────────────────────────────────────────────────────────────

  it('cancel() prevents further loads', async () => {
    const loader = new AssetLoader(MANIFEST_URL, { integrity: false });
    loader.cancel();

    await expect(loader.load('textures/albedo.png')).rejects.toMatchObject({
      type: 'abort',
    });
  });

  // ── manifest fetch failure ────────────────────────────────────────────

  it('init() throws LoadError on manifest 500', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response('Server Error', { status: 500 }))
      )
    );

    const loader = new AssetLoader(MANIFEST_URL);
    await expect(loader.init()).rejects.toMatchObject({
      type: 'network',
      key: '__manifest__',
    });
  });
});
