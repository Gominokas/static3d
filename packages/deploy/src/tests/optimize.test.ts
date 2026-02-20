/**
 * optimize.test.ts
 *
 * packages/deploy/src/build/optimize.ts のユニットテスト。
 *
 * テスト戦略:
 *   1. 純粋ユーティリティ関数 (formatBytes, formatOptimizeLog, computeReductionRatio)
 *      → 引数を与えて出力を検証（副作用なし）
 *   2. extractOptimizeConfig
 *      → JSON オブジェクトからの抽出ロジック
 *   3. optimizeGlb 統合テスト
 *      → 実際の GLB バイナリを生成して最適化パイプラインを実行
 *      → 出力が GLB (binary glTF, magic 0x46546C67) であることを確認
 *      → enable=false / draco=false / prune only など各フラグをテスト
 *   4. optimizeAsset
 *      → enabled=false のとき null + skip ログを返すことを確認
 *
 * NOTE: @gltf-transform は ESM only。vitest は ESM モードで動作するため問題なし。
 */

import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ────────────────────────────────────────────────────────────────────────────
// 最小限の有効な GLB ファイルを生成するヘルパー
// ────────────────────────────────────────────────────────────────────────────

/**
 * 最小限の GLB バイナリを Buffer として生成する。
 *
 * GLB フォーマット:
 *   [12 byte header][JSON chunk][BIN chunk(任意)]
 *
 * header:
 *   magic    = 0x46546C67 ("glTF", little-endian)
 *   version  = 2
 *   length   = 全体バイト数
 *
 * JSON chunk:
 *   chunkLength = JSON バイト数（4 の倍数に padding）
 *   chunkType   = 0x4E4F534A ("JSON")
 *   chunkData   = UTF-8 JSON + space padding
 */
function makeMinimalGlb(extraMeshData?: Uint8Array): Buffer {
  // 最小限の glTF JSON（ジオメトリなし）
  const gltfJson = JSON.stringify({
    asset: { version: '2.0', generator: 'static3d test' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'RootNode' }],
    // メッシュがないと Draco は何もしない — OK
  });

  // JSON を 4 バイト境界に align
  const jsonBytes = Buffer.from(gltfJson, 'utf-8');
  const jsonPadded = Math.ceil(jsonBytes.length / 4) * 4;
  const jsonChunk = Buffer.alloc(jsonPadded, 0x20); // space padding
  jsonBytes.copy(jsonChunk);

  // GLB header (12 bytes) + JSON chunk header (8 bytes) + JSON data
  const totalLength = 12 + 8 + jsonPadded;
  const buf = Buffer.alloc(totalLength);
  let offset = 0;

  // Header
  buf.writeUInt32LE(0x46546C67, offset); offset += 4; // magic "glTF"
  buf.writeUInt32LE(2, offset);          offset += 4; // version
  buf.writeUInt32LE(totalLength, offset); offset += 4; // length

  // JSON chunk
  buf.writeUInt32LE(jsonPadded, offset); offset += 4; // chunkLength
  buf.writeUInt32LE(0x4E4F534A, offset); offset += 4; // chunkType "JSON"
  jsonChunk.copy(buf, offset);

  return buf;
}

/**
 * 単純な三角形メッシュを含む GLB を生成する（Draco 圧縮のテスト用）。
 * 頂点 3 個（float32 × 3）、インデックス 3 個（uint16）を持つ最小 mesh。
 */
function makeTriangleGlb(): Buffer {
  // BIN バッファ: 頂点データ + インデックスデータ
  const positions = new Float32Array([
    0.0, 0.0, 0.0,   // v0
    1.0, 0.0, 0.0,   // v1
    0.0, 1.0, 0.0,   // v2
  ]);
  const indices = new Uint16Array([0, 1, 2]);

  // 4 バイト境界に align
  const posBytes = Buffer.from(positions.buffer);
  const idxBytes = Buffer.from(indices.buffer);
  const idxOffset = posBytes.length; // positions は 36 bytes → already aligned

  const binBuffer = Buffer.concat([posBytes, idxBytes]);
  // BIN を 4 バイト境界に padding
  const binPadded = Math.ceil(binBuffer.length / 4) * 4;
  const binChunkData = Buffer.alloc(binPadded, 0);
  binBuffer.copy(binChunkData);

  const gltfJson = JSON.stringify({
    asset: { version: '2.0', generator: 'static3d test' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0 },
        indices: 1,
        mode: 4,  // TRIANGLES
      }],
    }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,  // FLOAT
        count: 3,
        type: 'VEC3',
        byteOffset: 0,
        max: [1.0, 1.0, 0.0],
        min: [0.0, 0.0, 0.0],
      },
      {
        bufferView: 1,
        componentType: 5123,  // UNSIGNED_SHORT
        count: 3,
        type: 'SCALAR',
        byteOffset: 0,
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes.length },
      { buffer: 0, byteOffset: idxOffset, byteLength: idxBytes.length },
    ],
    buffers: [{ byteLength: binBuffer.length }],
  });

  const jsonBytes = Buffer.from(gltfJson, 'utf-8');
  const jsonPadded = Math.ceil(jsonBytes.length / 4) * 4;
  const jsonChunkData = Buffer.alloc(jsonPadded, 0x20);
  jsonBytes.copy(jsonChunkData);

  const totalLength = 12 + 8 + jsonPadded + 8 + binPadded;
  const glb = Buffer.alloc(totalLength);
  let off = 0;

  // Header
  glb.writeUInt32LE(0x46546C67, off); off += 4;
  glb.writeUInt32LE(2, off);          off += 4;
  glb.writeUInt32LE(totalLength, off); off += 4;

  // JSON chunk
  glb.writeUInt32LE(jsonPadded, off);   off += 4;
  glb.writeUInt32LE(0x4E4F534A, off);   off += 4;
  jsonChunkData.copy(glb, off);          off += jsonPadded;

  // BIN chunk
  glb.writeUInt32LE(binPadded, off);    off += 4;
  glb.writeUInt32LE(0x004E4942, off);   off += 4; // "BIN\0"
  binChunkData.copy(glb, off);

  return glb;
}

/** GLB magic bytes の検証 */
function isGlbMagic(buf: Buffer): boolean {
  return buf.length >= 4 && buf.readUInt32LE(0) === 0x46546C67;
}

// ────────────────────────────────────────────────────────────────────────────
// 1. formatBytes
// ────────────────────────────────────────────────────────────────────────────

describe('formatBytes', () => {
  it('formats bytes as B', async () => {
    const { formatBytes } = await import('../build/optimize.js');
    expect(formatBytes(512)).toBe('512B');
  });

  it('formats kilobytes as KB', async () => {
    const { formatBytes } = await import('../build/optimize.js');
    expect(formatBytes(2048)).toBe('2.0KB');
  });

  it('formats megabytes as MB', async () => {
    const { formatBytes } = await import('../build/optimize.js');
    expect(formatBytes(6_700_000)).toBe('6.4MB');
  });

  it('formats 1MB boundary', async () => {
    const { formatBytes } = await import('../build/optimize.js');
    expect(formatBytes(1024 * 1024)).toBe('1.0MB');
  });

  it('formats 0 as 0B', async () => {
    const { formatBytes } = await import('../build/optimize.js');
    expect(formatBytes(0)).toBe('0B');
  });

  it('formats 1023 as KB boundary', async () => {
    const { formatBytes } = await import('../build/optimize.js');
    // 1023 < 1024 → bytes
    expect(formatBytes(1023)).toBe('1023B');
  });

  it('formats large file correctly', async () => {
    const { formatBytes } = await import('../build/optimize.js');
    expect(formatBytes(2_100_000)).toBe('2.0MB');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. computeReductionRatio
// ────────────────────────────────────────────────────────────────────────────

describe('computeReductionRatio', () => {
  it('returns 0 when sizeBefore=0', async () => {
    const { computeReductionRatio } = await import('../build/optimize.js');
    expect(computeReductionRatio(0, 0)).toBe(0);
  });

  it('computes 67% reduction correctly', async () => {
    const { computeReductionRatio } = await import('../build/optimize.js');
    const ratio = computeReductionRatio(3_000_000, 990_000);
    expect(ratio).toBeCloseTo(0.67, 1);
  });

  it('returns 0 when sizeAfter >= sizeBefore', async () => {
    const { computeReductionRatio } = await import('../build/optimize.js');
    expect(computeReductionRatio(100, 200)).toBe(0);
  });

  it('computes 50% reduction', async () => {
    const { computeReductionRatio } = await import('../build/optimize.js');
    expect(computeReductionRatio(1000, 500)).toBeCloseTo(0.5, 5);
  });

  it('computes 100% reduction (empty output)', async () => {
    const { computeReductionRatio } = await import('../build/optimize.js');
    expect(computeReductionRatio(1000, 0)).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. formatOptimizeLog
// ────────────────────────────────────────────────────────────────────────────

describe('formatOptimizeLog', () => {
  it('produces the expected log format', async () => {
    const { formatOptimizeLog } = await import('../build/optimize.js');
    const log = formatOptimizeLog('bakery_shop.glb', 6_700_000, 2_100_000, 0.6865);
    expect(log).toBe('[OPTIMIZE] bakery_shop.glb: 6.4MB → 2.0MB (-69%)');
  });

  it('includes [OPTIMIZE] prefix', async () => {
    const { formatOptimizeLog } = await import('../build/optimize.js');
    const log = formatOptimizeLog('scene.glb', 1024, 512, 0.5);
    expect(log.startsWith('[OPTIMIZE]')).toBe(true);
  });

  it('includes the filename', async () => {
    const { formatOptimizeLog } = await import('../build/optimize.js');
    const log = formatOptimizeLog('my_model.glb', 2048, 1024, 0.5);
    expect(log).toContain('my_model.glb');
  });

  it('includes percentage', async () => {
    const { formatOptimizeLog } = await import('../build/optimize.js');
    const log = formatOptimizeLog('x.glb', 1000, 330, 0.67);
    expect(log).toContain('-67%');
  });

  it('includes arrow →', async () => {
    const { formatOptimizeLog } = await import('../build/optimize.js');
    const log = formatOptimizeLog('x.glb', 1000, 500, 0.5);
    expect(log).toContain('→');
  });

  it('shows before and after sizes', async () => {
    const { formatOptimizeLog, formatBytes } = await import('../build/optimize.js');
    const before = 5_000_000;
    const after = 1_500_000;
    const ratio = (before - after) / before;
    const log = formatOptimizeLog('test.glb', before, after, ratio);
    expect(log).toContain(formatBytes(before));
    expect(log).toContain(formatBytes(after));
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. formatOptimizeSkipLog
// ────────────────────────────────────────────────────────────────────────────

describe('formatOptimizeSkipLog', () => {
  it('includes [OPTIMIZE] prefix', async () => {
    const { formatOptimizeSkipLog } = await import('../build/optimize.js');
    expect(formatOptimizeSkipLog('scene.glb').startsWith('[OPTIMIZE]')).toBe(true);
  });

  it('includes filename', async () => {
    const { formatOptimizeSkipLog } = await import('../build/optimize.js');
    expect(formatOptimizeSkipLog('model.glb')).toContain('model.glb');
  });

  it('includes "skipped"', async () => {
    const { formatOptimizeSkipLog } = await import('../build/optimize.js');
    expect(formatOptimizeSkipLog('x.glb')).toContain('skipped');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 5. extractOptimizeConfig
// ────────────────────────────────────────────────────────────────────────────

describe('extractOptimizeConfig', () => {
  it('extracts optimize config from full config object', async () => {
    const { extractOptimizeConfig } = await import('../config/optimize-config.js');
    const config = {
      schemaVersion: 1,
      project: 'test',
      optimize: { enabled: true, draco: true, prune: true, dedup: false },
    };
    const opt = extractOptimizeConfig(config);
    expect(opt).toBeDefined();
    expect(opt!.enabled).toBe(true);
    expect(opt!.draco).toBe(true);
    expect(opt!.dedup).toBe(false);
  });

  it('returns undefined when optimize is missing', async () => {
    const { extractOptimizeConfig } = await import('../config/optimize-config.js');
    expect(extractOptimizeConfig({ schemaVersion: 1, project: 'x' })).toBeUndefined();
  });

  it('returns undefined when optimize is null', async () => {
    const { extractOptimizeConfig } = await import('../config/optimize-config.js');
    expect(extractOptimizeConfig({ optimize: null })).toBeUndefined();
  });

  it('returns undefined when optimize is a non-object', async () => {
    const { extractOptimizeConfig } = await import('../config/optimize-config.js');
    expect(extractOptimizeConfig({ optimize: 'yes' })).toBeUndefined();
  });

  it('handles partial optimize config (only enabled)', async () => {
    const { extractOptimizeConfig } = await import('../config/optimize-config.js');
    const config = { optimize: { enabled: false } };
    const opt = extractOptimizeConfig(config);
    expect(opt).toBeDefined();
    expect(opt!.enabled).toBe(false);
    expect(opt!.draco).toBeUndefined();
  });

  it('preserves dracoOptions', async () => {
    const { extractOptimizeConfig } = await import('../config/optimize-config.js');
    const config = {
      optimize: {
        enabled: true,
        draco: true,
        dracoOptions: { encodeSpeed: 3, decodeSpeed: 3 },
      },
    };
    const opt = extractOptimizeConfig(config);
    expect(opt!.dracoOptions?.encodeSpeed).toBe(3);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 6. optimizeAsset — enabled=false (skip path, no GLB needed)
// ────────────────────────────────────────────────────────────────────────────

describe('optimizeAsset — skip mode', () => {
  it('returns null buffer and skip log when enabled=false', async () => {
    const { optimizeAsset } = await import('../build/optimize.js');
    // enabled=false なので実際のファイルは不要
    const { buffer, logLine } = await optimizeAsset('/nonexistent/fake.glb', {
      enabled: false,
    });
    expect(buffer).toBeNull();
    expect(logLine).toContain('[OPTIMIZE]');
    expect(logLine).toContain('skipped');
    expect(logLine).toContain('fake.glb');
  });

  it('returns skip log with correct filename', async () => {
    const { optimizeAsset } = await import('../build/optimize.js');
    const { logLine } = await optimizeAsset('/path/to/my_scene.glb', {
      enabled: false,
    });
    expect(logLine).toContain('my_scene.glb');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 7. optimizeGlb — integration (minimal GLB)
// ────────────────────────────────────────────────────────────────────────────

describe('optimizeGlb — minimal GLB (no mesh)', () => {
  let tmpDir: string;

  // テスト用一時ディレクトリをセットアップ
  const setup = () => {
    tmpDir = join(tmpdir(), `static3d-opt-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  };

  const cleanup = () => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  };

  it('outputs a valid GLB (magic bytes = glTF)', async () => {
    setup();
    try {
      const { optimizeGlb } = await import('../build/optimize.js');
      const glbPath = join(tmpDir, 'minimal.glb');
      writeFileSync(glbPath, makeMinimalGlb());

      const result = await optimizeGlb(glbPath, { draco: false, prune: true, dedup: true });
      expect(isGlbMagic(result.buffer)).toBe(true);
    } finally {
      cleanup();
    }
  }, 30_000);

  it('OptimizeResult has sizeBefore and sizeAfter', async () => {
    setup();
    try {
      const { optimizeGlb } = await import('../build/optimize.js');
      const glbPath = join(tmpDir, 'minimal.glb');
      const inputBuf = makeMinimalGlb();
      writeFileSync(glbPath, inputBuf);

      const result = await optimizeGlb(glbPath, { draco: false, prune: true, dedup: true });
      expect(result.sizeBefore).toBe(inputBuf.length);
      expect(result.sizeAfter).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  }, 30_000);

  it('reductionRatio is a number between 0 and 1', async () => {
    setup();
    try {
      const { optimizeGlb } = await import('../build/optimize.js');
      const glbPath = join(tmpDir, 'minimal.glb');
      writeFileSync(glbPath, makeMinimalGlb());

      const result = await optimizeGlb(glbPath, { draco: false, prune: true, dedup: true });
      expect(result.reductionRatio).toBeGreaterThanOrEqual(0);
      expect(result.reductionRatio).toBeLessThanOrEqual(1);
    } finally {
      cleanup();
    }
  }, 30_000);

  it('prune-only mode still produces valid GLB', async () => {
    setup();
    try {
      const { optimizeGlb } = await import('../build/optimize.js');
      const glbPath = join(tmpDir, 'prune-only.glb');
      writeFileSync(glbPath, makeMinimalGlb());

      const result = await optimizeGlb(glbPath, { draco: false, prune: true, dedup: false });
      expect(isGlbMagic(result.buffer)).toBe(true);
    } finally {
      cleanup();
    }
  }, 30_000);

  it('dedup-only mode still produces valid GLB', async () => {
    setup();
    try {
      const { optimizeGlb } = await import('../build/optimize.js');
      const glbPath = join(tmpDir, 'dedup-only.glb');
      writeFileSync(glbPath, makeMinimalGlb());

      const result = await optimizeGlb(glbPath, { draco: false, prune: false, dedup: true });
      expect(isGlbMagic(result.buffer)).toBe(true);
    } finally {
      cleanup();
    }
  }, 30_000);
});

// ────────────────────────────────────────────────────────────────────────────
// 8. optimizeGlb — integration (triangle mesh with Draco)
// ────────────────────────────────────────────────────────────────────────────

describe('optimizeGlb — triangle mesh with Draco', () => {
  let tmpDir: string;

  const setup = () => {
    tmpDir = join(tmpdir(), `static3d-draco-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  };

  const cleanup = () => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  };

  it('Draco compression produces valid GLB', async () => {
    setup();
    try {
      const { optimizeGlb } = await import('../build/optimize.js');
      const glbPath = join(tmpDir, 'triangle.glb');
      writeFileSync(glbPath, makeTriangleGlb());

      const result = await optimizeGlb(glbPath, { draco: true, prune: true, dedup: true });
      expect(isGlbMagic(result.buffer)).toBe(true);
    } finally {
      cleanup();
    }
  }, 60_000);

  it('Draco compression sizeBefore is the original file size', async () => {
    setup();
    try {
      const { optimizeGlb } = await import('../build/optimize.js');
      const glbPath = join(tmpDir, 'triangle.glb');
      const input = makeTriangleGlb();
      writeFileSync(glbPath, input);

      const result = await optimizeGlb(glbPath, { draco: true, prune: true, dedup: true });
      expect(result.sizeBefore).toBe(input.length);
    } finally {
      cleanup();
    }
  }, 60_000);

  it('optimizeAsset returns buffer and log for GLB with Draco', async () => {
    setup();
    try {
      const { optimizeAsset } = await import('../build/optimize.js');
      const glbPath = join(tmpDir, 'scene.glb');
      writeFileSync(glbPath, makeTriangleGlb());

      const { buffer, logLine } = await optimizeAsset(glbPath, {
        enabled: true,
        draco: true,
        prune: true,
        dedup: true,
      });

      expect(buffer).not.toBeNull();
      expect(isGlbMagic(buffer!)).toBe(true);
      expect(logLine).toContain('[OPTIMIZE]');
      expect(logLine).toContain('scene.glb');
      expect(logLine).toContain('→');
    } finally {
      cleanup();
    }
  }, 60_000);
});
