import { describe, it, expect } from 'vitest';
import {
  computeHash,
  computeFullHash,
  insertHash,
  hashAsset,
  computeContentDigest,
  getGitShortSha,
} from '../build/hash.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('hash', () => {
  it('computeHash returns correct length', () => {
    const buf = Buffer.from('hello world');
    const h8 = computeHash(buf, 8);
    const h12 = computeHash(buf, 12);
    expect(h8).toHaveLength(8);
    expect(h12).toHaveLength(12);
  });

  it('computeHash is deterministic', () => {
    const buf = Buffer.from('hello world');
    expect(computeHash(buf)).toBe(computeHash(buf));
  });

  it('computeFullHash returns 64-char hex', () => {
    const buf = Buffer.from('hello world');
    const full = computeFullHash(buf);
    expect(full).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(full)).toBe(true);
  });

  it('insertHash inserts before extension', () => {
    expect(insertHash('model.glb', 'abc12345')).toBe('model.abc12345.glb');
    expect(insertHash('texture.png', 'deadbeef')).toBe('texture.deadbeef.png');
    expect(insertHash('noext', 'abc12345')).toBe('noext.abc12345');
  });

  it('hashAsset returns correct structure', () => {
    const dir = join(tmpdir(), `static3d-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, 'test.bin');
    writeFileSync(filePath, 'test content');

    const result = hashAsset('models/test.bin', filePath, 12, 8);
    expect(result.key).toBe('models/test.bin');
    expect(result.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.hashedKey).toMatch(/^models\/test\.[0-9a-f]{8}\.bin$/);
    expect(result.hashedFilename).toMatch(/^test\.[0-9a-f]{8}\.bin$/);

    rmSync(dir, { recursive: true });
  });
});

describe('computeContentDigest', () => {
  it('returns 12-char hex string', () => {
    const digest = computeContentDigest(['sha256:' + 'a'.repeat(64)]);
    expect(digest).toHaveLength(12);
    expect(/^[0-9a-f]+$/.test(digest)).toBe(true);
  });

  it('is deterministic — same hashes always produce same digest', () => {
    const hashes = [
      'sha256:' + 'a'.repeat(64),
      'sha256:' + 'b'.repeat(64),
      'sha256:' + 'c'.repeat(64),
    ];
    expect(computeContentDigest(hashes)).toBe(computeContentDigest(hashes));
  });

  it('is order-independent — input order does not affect result', () => {
    const h1 = 'sha256:' + 'a'.repeat(64);
    const h2 = 'sha256:' + 'b'.repeat(64);
    expect(computeContentDigest([h1, h2])).toBe(computeContentDigest([h2, h1]));
  });

  it('changes when content changes', () => {
    const base = ['sha256:' + 'a'.repeat(64), 'sha256:' + 'b'.repeat(64)];
    const modified = ['sha256:' + 'a'.repeat(64), 'sha256:' + 'c'.repeat(64)];
    expect(computeContentDigest(base)).not.toBe(computeContentDigest(modified));
  });
});

describe('getGitShortSha', () => {
  it('returns string or null (never throws)', () => {
    // CI / Git 初期化済み環境どちらでも例外を投げないこと
    const result = getGitShortSha();
    expect(result === null || typeof result === 'string').toBe(true);
    if (result !== null) {
      // Git SHA は 7 文字以上の hex
      expect(result.length).toBeGreaterThanOrEqual(4);
    }
  });
});
