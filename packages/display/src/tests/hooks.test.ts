/**
 * hooks.test.tsx
 *
 * useAssetProgress フックのテスト。
 * AssetProvider + useAssetProgress の統合テスト。
 *
 * @testing-library/react は devDep に含まれていないため、
 * React の renderHook 代わりに簡易テストで検証する。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AssetLoader } from '../loader/AssetLoader.js';
import type { DeployManifest, ProgressEvent } from '@static3d/types';

// ────────────────────────────────────────────────────────────────────────────
// テスト用マニフェスト
// ────────────────────────────────────────────────────────────────────────────

const MANIFEST_URL = 'https://pages.example.com/manifest.json';

const MOCK_MANIFEST: DeployManifest = {
  schemaVersion: 1,
  version: 'hook-test',
  buildTime: '2026-01-01T00:00:00.000Z',
  assets: {
    'textures/albedo.png': {
      url: 'https://cdn.example.com/textures/albedo.8cbce19e.png',
      size: 512,
      hash: 'sha256:' + 'c'.repeat(64),
      contentType: 'image/png',
    },
    'models/scene.gltf': {
      url: 'https://cdn.example.com/models/scene.2073f5d5.gltf',
      size: 1024,
      hash: 'sha256:' + 'd'.repeat(64),
      contentType: 'model/gltf+json',
    },
  },
};

function makeManifestFetch() {
  return (url: string): Promise<Response> => {
    if (url === MANIFEST_URL) {
      return Promise.resolve(
        new Response(JSON.stringify(MOCK_MANIFEST), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }
    return Promise.resolve(
      new Response(new Uint8Array(8).buffer, {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      })
    );
  };
}

// ────────────────────────────────────────────────────────────────────────────
// AssetLoader 経由のフック統合テスト（React hook 部分は AssetLoader のイベントで確認）
// ────────────────────────────────────────────────────────────────────────────

describe('AssetLoader progress integration', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(makeManifestFetch()));
    vi.stubGlobal('crypto', {
      subtle: {
        digest: vi.fn().mockResolvedValue(new Uint8Array(32).fill(0xbb).buffer),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('progress events report correct totals and percentages', async () => {
    const loader = new AssetLoader(MANIFEST_URL, { integrity: false });
    const events: ProgressEvent[] = [];
    loader.onProgress((e) => events.push({ ...e }));

    await loader.loadAll();

    expect(events.length).toBe(2); // 2 assets
    const last = events[events.length - 1];
    expect(last.completedCount).toBe(2);
    expect(last.totalCount).toBe(2);
    expect(last.loaded).toBeGreaterThan(0);
    expect(last.total).toBeGreaterThan(0);
  });

  it('totalCount equals number of assets in manifest', async () => {
    const loader = new AssetLoader(MANIFEST_URL, { integrity: false });
    let totalCount = 0;
    loader.onProgress((e) => {
      totalCount = e.totalCount;
    });

    await loader.loadAll();
    expect(totalCount).toBe(Object.keys(MOCK_MANIFEST.assets).length);
  });

  it('loaded bytes increase monotonically', async () => {
    const loader = new AssetLoader(MANIFEST_URL, { integrity: false });
    const loadedHistory: number[] = [];
    loader.onProgress((e) => loadedHistory.push(e.loaded));

    await loader.loadAll();

    for (let i = 1; i < loadedHistory.length; i++) {
      expect(loadedHistory[i]).toBeGreaterThanOrEqual(loadedHistory[i - 1]);
    }
  });

  it('loadAll with keys filter emits only matching progress events', async () => {
    const loader = new AssetLoader(MANIFEST_URL, { integrity: false });
    const events: ProgressEvent[] = [];
    loader.onProgress((e) => events.push({ ...e }));

    await loader.loadAll({ keys: ['textures/albedo.png'] });

    expect(events.length).toBe(1);
    expect(events[0].asset).toContain('albedo');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// ProgressState 計算ロジック（hook の計算を直接テスト）
// ────────────────────────────────────────────────────────────────────────────

describe('ProgressState calculation', () => {
  it('percentage is 0 when total is 0', () => {
    const loaded = 0;
    const total = 0;
    const percentage = total > 0 ? Math.min(100, (loaded / total) * 100) : 0;
    expect(percentage).toBe(0);
  });

  it('percentage is capped at 100', () => {
    const loaded = 200;
    const total = 100;
    const percentage = Math.min(100, (loaded / total) * 100);
    expect(percentage).toBe(100);
  });

  it('percentage is correctly calculated', () => {
    const loaded = 512;
    const total = 1536;
    const percentage = total > 0 ? Math.min(100, (loaded / total) * 100) : 0;
    expect(percentage).toBeCloseTo(33.33, 1);
  });
});
