/**
 * plugin.integration.test.ts
 *
 * Vite build API を直接呼んで closeBundle フックが正しく動くことを検証する。
 * dev server のミドルウェアは HTTP を立てずに直接テストする。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';

// ────────────────────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────────────────────

let tmpDir: string;
let deferredDir: string;
let immediateDir: string;
let configPath: string;

function setupFixture() {
  tmpDir = join(
    tmpdir(),
    `static3d-plugin-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  deferredDir = join(tmpDir, 'src/assets/deferred');
  immediateDir = join(tmpDir, 'src/assets/immediate');
  mkdirSync(join(deferredDir, 'textures'), { recursive: true });
  mkdirSync(join(deferredDir, 'models'), { recursive: true });
  mkdirSync(immediateDir, { recursive: true });

  writeFileSync(join(deferredDir, 'textures', 'albedo.png'), 'PNG_DATA');
  writeFileSync(join(deferredDir, 'models', 'scene.bin'), 'BIN_DATA');
  writeFileSync(
    join(deferredDir, 'models', 'scene.gltf'),
    JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'scene.bin' }] })
  );

  // static3d.config.json を tmpDir に作成
  configPath = join(tmpDir, 'static3d.config.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      project: 'test',
      deploy: {
        pages: { outputDir: join(tmpDir, 'dist/pages') },
        cdn: {
          provider: 'cloudflare-r2',
          bucket: 'test-bucket',
          baseUrl: 'https://cdn.example.com',
        },
        assets: {
          immediateDir,
          deferredDir,
          hashLength: 8,
        },
      },
    })
  );
}

function teardown() {
  rmSync(tmpDir, { recursive: true, force: true });
}

// ────────────────────────────────────────────────────────────────────────────
// devServer middleware unit tests (no HTTP)
// ────────────────────────────────────────────────────────────────────────────

describe('manifestMiddleware', () => {
  beforeEach(setupFixture);
  afterEach(teardown);

  it('responds to GET /manifest.json with JSON', async () => {
    const { manifestMiddleware } = await import('../vite/devServer.js');
    const mw = manifestMiddleware({ deferredDir });

    let responseBody = '';
    let contentType = '';
    const req = { url: '/manifest.json' } as IncomingMessage;
    const res = {
      setHeader(k: string, v: string) { if (k === 'Content-Type') contentType = v; },
      end(body: string) { responseBody = body; },
      statusCode: 200,
    } as unknown as ServerResponse;
    const next = vi.fn();

    // ミドルウェアは async なので少し待つ
    mw(req, res, next);
    await new Promise((r) => setTimeout(r, 200));

    expect(next).not.toHaveBeenCalled();
    expect(contentType).toContain('application/json');
    const parsed = JSON.parse(responseBody);
    expect(parsed.version).toBe('dev');
    expect(parsed.schemaVersion).toBe(1);
    expect(typeof parsed.assets).toBe('object');
  });

  it('calls next() for non-/manifest.json paths', async () => {
    const { manifestMiddleware } = await import('../vite/devServer.js');
    const mw = manifestMiddleware({ deferredDir });

    const req = { url: '/other.json' } as IncomingMessage;
    const res = {} as ServerResponse;
    const next = vi.fn();

    mw(req, res, next);
    await new Promise((r) => setTimeout(r, 50));

    expect(next).toHaveBeenCalled();
  });
});

describe('cdnMiddleware', () => {
  beforeEach(setupFixture);
  afterEach(teardown);

  it('serves a file from deferredDir for /cdn/* requests', async () => {
    const { cdnMiddleware } = await import('../vite/devServer.js');
    const mw = cdnMiddleware({ deferredDir });

    let responseBody: Buffer | string = '';
    let contentType = '';
    const req = { url: '/cdn/textures/albedo.png' } as IncomingMessage;
    const res = {
      setHeader(k: string, v: string) { if (k === 'Content-Type') contentType = v; },
      end(body: Buffer | string) { responseBody = body; },
      statusCode: 200,
    } as unknown as ServerResponse;
    const next = vi.fn();

    mw(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(contentType).toBe('image/png');
    expect(responseBody.toString()).toBe('PNG_DATA');
  });

  it('calls next() when file does not exist', async () => {
    const { cdnMiddleware } = await import('../vite/devServer.js');
    const mw = cdnMiddleware({ deferredDir });

    const req = { url: '/cdn/nonexistent.png' } as IncomingMessage;
    const res = {} as ServerResponse;
    const next = vi.fn();

    mw(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('calls next() for non-/cdn/ paths', async () => {
    const { cdnMiddleware } = await import('../vite/devServer.js');
    const mw = cdnMiddleware({ deferredDir });

    const req = { url: '/static/logo.png' } as IncomingMessage;
    const res = {} as ServerResponse;
    const next = vi.fn();

    mw(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('rejects path traversal attempts', async () => {
    const { cdnMiddleware } = await import('../vite/devServer.js');
    const mw = cdnMiddleware({ deferredDir });

    let statusCode = 200;
    let responseBody = '';
    const req = { url: '/cdn/../../../etc/passwd' } as IncomingMessage;
    const res = {
      setHeader: vi.fn(),
      end(body: string) { responseBody = body; },
      get statusCode() { return statusCode; },
      set statusCode(v: number) { statusCode = v; },
    } as unknown as ServerResponse;
    const next = vi.fn();

    mw(req, res, next);

    // path traversal は 400 か next() のどちらか
    // decoded に ".." が含まれるので 400 になる
    expect(statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// plugin factory
// ────────────────────────────────────────────────────────────────────────────

describe('static3d plugin', () => {
  it('has the correct plugin name', async () => {
    const { static3d } = await import('../vite/plugin.js');
    const plugin = static3d();
    expect(plugin.name).toBe('static3d');
  });

  it('exports static3d and static3dDeploy (alias)', async () => {
    const mod = await import('../vite/plugin.js');
    expect(typeof mod.static3d).toBe('function');
    expect(typeof mod.static3dDeploy).toBe('function');
    // alias は同一関数
    expect(mod.static3dDeploy).toBe(mod.static3d);
  });

  it('returns a Vite Plugin object with required hooks', async () => {
    const { static3d } = await import('../vite/plugin.js');
    const plugin = static3d();
    expect(typeof plugin.configResolved).toBe('function');
    expect(typeof plugin.configureServer).toBe('function');
    expect(typeof plugin.closeBundle).toBe('function');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// build integration — closeBundle
// ────────────────────────────────────────────────────────────────────────────

describe('static3d plugin closeBundle (build mode)', () => {
  beforeEach(setupFixture);
  afterEach(teardown);

  it('runs asset pipeline and outputs manifest.json in build mode', async () => {
    const { static3d } = await import('../vite/plugin.js');
    const plugin = static3d({ config: configPath });

    const pagesOutputDir = join(tmpDir, 'dist/pages');

    // configResolved を build モードで呼ぶ
    (plugin.configResolved as Function)({
      command: 'build',
      build: { outDir: join(tmpDir, 'dist') },
    });

    // closeBundle を呼ぶ（this は Rollup PluginContext の stub）
    const ctx = { warn: vi.fn(), error: vi.fn() };
    await (plugin.closeBundle as Function).call(ctx);

    // dist/pages/manifest.json が生成されていること
    const manifestPath = join(pagesOutputDir, 'manifest.json');
    expect(existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    expect(manifest.schemaVersion).toBe(1);
    expect(typeof manifest.assets).toBe('object');

    // 全 3 アセット (albedo.png, scene.bin, scene.gltf) が含まれること
    const keys = Object.keys(manifest.assets);
    expect(keys.length).toBe(3);
    expect(keys.some((k) => k.endsWith('.gltf'))).toBe(true);
  }, 20_000);

  it('does not run asset pipeline in dev mode', async () => {
    const { static3d } = await import('../vite/plugin.js');
    const plugin = static3d({ config: configPath });

    (plugin.configResolved as Function)({
      command: 'serve',   // dev モード
      build: { outDir: join(tmpDir, 'dist') },
    });

    const ctx = { warn: vi.fn(), error: vi.fn() };
    await (plugin.closeBundle as Function).call(ctx);

    // dev モードでは dist/pages/manifest.json が生成されない
    const manifestPath = join(tmpDir, 'dist/pages', 'manifest.json');
    expect(existsSync(manifestPath)).toBe(false);
  });

  it('calls this.warn instead of throwing when config is invalid', async () => {
    const { static3d } = await import('../vite/plugin.js');
    const plugin = static3d({ config: '/nonexistent/static3d.config.json' });

    (plugin.configResolved as Function)({
      command: 'build',
      build: { outDir: join(tmpDir, 'dist') },
    });

    const ctx = { warn: vi.fn(), error: vi.fn() };
    // エラーをスローせず、this.warn を呼ぶこと
    await expect(
      (plugin.closeBundle as Function).call(ctx)
    ).resolves.toBeUndefined();
    expect(ctx.warn).toHaveBeenCalled();
  });
});
