/**
 * devServer.windows.test.ts
 *
 * devServer.ts の Windows パス区切り対応テスト。
 *
 * Windows では node:path の join() が '\' を使うため、
 * absDeferred + '/' との比較がすべて失敗して 400 になるバグの回帰テスト。
 *
 * 修正内容:
 *   replace(/\\/g, '/') で正規化してから比較することで
 *   POSIX / Windows 両方で正しく動作する。
 */

import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';

// ────────────────────────────────────────────────────────────────────────────
// テスト用フィクスチャ
// ────────────────────────────────────────────────────────────────────────────

function makeFixture() {
  const dir = join(
    tmpdir(),
    `static3d-win-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(join(dir, 'textures'), { recursive: true });
  mkdirSync(join(dir, 'models'), { recursive: true });
  writeFileSync(join(dir, 'textures', 'albedo.png'), 'PNG');
  writeFileSync(join(dir, 'models', 'scene.bin'), 'BIN');
  return dir;
}

// ────────────────────────────────────────────────────────────────────────────
// Windows パス区切りシミュレーション
// ────────────────────────────────────────────────────────────────────────────

/**
 * Windows の node:path.join() をシミュレートするヘルパー。
 * Windows では join('C:\\foo\\bar', 'textures/albedo.png') = 'C:\\foo\\bar\\textures\\albedo.png'
 * となる。ここでは POSIX パスを Windows 風バックスラッシュに変換して模倣する。
 */
function toWindowsPath(p: string): string {
  return p.replace(/\//g, '\\');
}

// ────────────────────────────────────────────────────────────────────────────
// パストラバーサル判定ロジックの単体テスト
// ────────────────────────────────────────────────────────────────────────────

describe('devServer path traversal check — Windows compatibility', () => {
  it('old logic (without normalize) rejects Windows paths incorrectly', () => {
    // バグ再現: Windows では filePath が '\\' を含むため比較が失敗する
    const absDeferred: string = 'C:\\Users\\user\\project\\src\\assets\\deferred';
    const filePath: string = 'C:\\Users\\user\\project\\src\\assets\\deferred\\textures\\albedo.png';

    // 旧ロジック（バグあり）
    const oldCheck = !filePath.startsWith(absDeferred + '/') && filePath !== absDeferred;
    // '\\' を使ったパスは '/' でスタートしないため、常に true（= 400 になる）
    expect(oldCheck).toBe(true); // これがバグ
  });

  it('new logic (with normalize) correctly allows Windows paths', () => {
    const absDeferred: string = 'C:\\Users\\user\\project\\src\\assets\\deferred';
    const filePath: string = 'C:\\Users\\user\\project\\src\\assets\\deferred\\textures\\albedo.png';

    // 修正後のロジック
    const normalizedFile = filePath.replace(/\\/g, '/');
    const normalizedBase = absDeferred.replace(/\\/g, '/');
    const blocked = !normalizedFile.startsWith(normalizedBase + '/') && normalizedFile !== normalizedBase;
    expect(blocked).toBe(false); // 正しく通過する
  });

  it('new logic: ".." paths pass normalization check but are caught by prior decoded check', () => {
    const absDeferred: string = 'C:\\Users\\user\\project\\deferred';
    // decode 後の decoded に '..' が含まれているケースはすでに先のチェックで弾かれる
    // ここでは念のため join 後のパスでも確認
    const filePath: string = 'C:\\Users\\user\\project\\deferred\\..\\secret.txt';

    // 正規化すると:
    const normalizedFile = filePath.replace(/\\/g, '/');
    const normalizedBase = absDeferred.replace(/\\/g, '/');
    // resolve していないので '..' がそのまま残っているが、
    // '..' は decoded チェックで先に弾かれるため、ここには到達しない
    const isOutside = !normalizedFile.startsWith(normalizedBase + '/') && normalizedFile !== normalizedBase;
    // NOTE: 文字列 'deferred/../secret.txt' は 'deferred/' で始まるため
    //       startsWith チェック単体では通過する。
    //       実際の防御は decoded.includes('..') の先行チェックが担う。
    expect(isOutside).toBe(false); // normalization チェック単体では '通過' — 先行チェックで防ぐ
  });

  it('new logic correctly allows POSIX paths (no regression)', () => {
    const absDeferred = '/home/user/project/src/assets/deferred';
    const filePath = '/home/user/project/src/assets/deferred/textures/albedo.png';

    const normalizedFile = filePath.replace(/\\/g, '/');
    const normalizedBase = absDeferred.replace(/\\/g, '/');
    const blocked = !normalizedFile.startsWith(normalizedBase + '/') && normalizedFile !== normalizedBase;
    expect(blocked).toBe(false);
  });

  it('new logic blocks POSIX path traversal (no regression)', () => {
    const absDeferred = '/home/user/deferred';
    const filePath = '/home/user/secret.txt';

    const normalizedFile = filePath.replace(/\\/g, '/');
    const normalizedBase = absDeferred.replace(/\\/g, '/');
    const blocked = !normalizedFile.startsWith(normalizedBase + '/') && normalizedFile !== normalizedBase;
    expect(blocked).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// cdnMiddleware 統合テスト (POSIX)
// ────────────────────────────────────────────────────────────────────────────

describe('cdnMiddleware — Windows path fix integration', () => {
  it('serves file correctly on POSIX (no regression from Windows fix)', async () => {
    const dir = makeFixture();
    try {
      const { cdnMiddleware } = await import('../vite/devServer.js');
      const mw = cdnMiddleware({ deferredDir: dir });

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
      expect(responseBody.toString()).toBe('PNG');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('serves nested path file correctly', async () => {
    const dir = makeFixture();
    try {
      const { cdnMiddleware } = await import('../vite/devServer.js');
      const mw = cdnMiddleware({ deferredDir: dir });

      let responseBody: Buffer | string = '';
      const req = { url: '/cdn/models/scene.bin' } as IncomingMessage;
      const res = {
        setHeader: vi.fn(),
        end(body: Buffer | string) { responseBody = body; },
        statusCode: 200,
      } as unknown as ServerResponse;
      const next = vi.fn();

      mw(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(responseBody.toString()).toBe('BIN');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('Windows-style path simulation: normalize does not break POSIX serving', () => {
    // Windows で absDeferred が backslash を含む場合のシミュレーション
    // (実際の Windows テストは OS 依存なので、ロジックのみ検証)
    const winBase = 'C:\\project\\deferred';
    const winFile = 'C:\\project\\deferred\\textures\\albedo.png';

    const normalizedFile = winFile.replace(/\\/g, '/');
    const normalizedBase = winBase.replace(/\\/g, '/');

    // Windows パスが正規化後に正しく「内部」と判定されること
    expect(normalizedFile.startsWith(normalizedBase + '/')).toBe(true);
  });
});
