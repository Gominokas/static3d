/**
 * optimize.ts
 *
 * glTF-Transform を使って GLB / glTF ファイルを最適化するパイプライン。
 *
 * 適用する変換（すべてオプションで個別 on/off）:
 *   1. dedup   — 重複バッファ/テクスチャ/マテリアル/アクセサ等を除去
 *   2. prune   — 未使用ノード/マテリアル/テクスチャ等を削除
 *   3. draco   — KHR_draco_mesh_compression でメッシュジオメトリを圧縮
 *
 * 圧縮前後のサイズをログ出力する:
 *   [OPTIMIZE] scene.glb: 6.4MB → 2.1MB (-67%)
 *
 * ## 使い方
 *
 *   const result = await optimizeGlb(absolutePath, {
 *     draco: true,
 *     prune: true,
 *     dedup: true,
 *   });
 *   // result.buffer — 最適化済み GLB バイナリ
 *   // result.sizeBefore / result.sizeAfter
 *
 * ## ファイル形式対応
 *
 * - .glb  → NodeIO で読み込み → 変換 → GLB バッファとして書き出し
 * - .gltf → 変換後 .gltf+.bin として返すのではなく、
 *            GLB にまとめて返す（単一バッファで管理しやすい）
 *
 * ## Node.js 専用
 *
 * draco3dgltf / @gltf-transform は Node.js 環境のみ対応。
 * ブラウザでは使わないこと。
 */

import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { draco, prune, dedup } from '@gltf-transform/functions';
import { createEncoderModule } from 'draco3dgltf';
import { readFileSync } from 'node:fs';
import { extname, basename } from 'node:path';


// ────────────────────────────────────────────────────────────────────────────
// 公開型
// ────────────────────────────────────────────────────────────────────────────

/** optimize.ts への設定オプション */
export interface OptimizeOptions {
  /** Draco 圧縮を適用する（デフォルト: true） */
  draco?: boolean;
  /** 未使用リソースを prune する（デフォルト: true） */
  prune?: boolean;
  /** 重複データを dedup する（デフォルト: true） */
  dedup?: boolean;
  /**
   * Draco 圧縮レベルのオプション（省略時はデフォルト値）
   * encodeSpeed/decodeSpeed: 0〜10 (低=高圧縮)
   */
  dracoOptions?: {
    encodeSpeed?: number;
    decodeSpeed?: number;
    quantizePosition?: number;
    quantizeNormal?: number;
    quantizeTexcoord?: number;
    quantizeColor?: number;
    quantizeGeneric?: number;
  };
}

/** 最適化結果 */
export interface OptimizeResult {
  /** 最適化済み GLB のバイナリバッファ */
  buffer: Buffer;
  /** 最適化前のバイトサイズ */
  sizeBefore: number;
  /** 最適化後のバイトサイズ */
  sizeAfter: number;
  /** 削減率（0〜1、例: 0.67 = 67% 削減） */
  reductionRatio: number;
}

// ────────────────────────────────────────────────────────────────────────────
// ユーティリティ
// ────────────────────────────────────────────────────────────────────────────

/**
 * バイト数を人間が読みやすい文字列に変換する。
 * 例: 6_710_000 → "6.4MB"
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${bytes}B`;
}

/**
 * 最適化ログ文字列を生成する純粋関数。
 * 例: "[OPTIMIZE] bakery_shop.glb: 6.4MB → 2.1MB (-67%)"
 */
export function formatOptimizeLog(
  filename: string,
  sizeBefore: number,
  sizeAfter: number,
  reductionRatio: number
): string {
  const pct = Math.round(reductionRatio * 100);
  return `[OPTIMIZE] ${filename}: ${formatBytes(sizeBefore)} → ${formatBytes(sizeAfter)} (-${pct}%)`;
}

/**
 * optimize がスキップされた場合のログ文字列（変換なし）。
 */
export function formatOptimizeSkipLog(filename: string): string {
  return `[OPTIMIZE] ${filename}: skipped (optimize.enabled=false)`;
}

/**
 * 削減率を計算する純粋関数。
 */
export function computeReductionRatio(sizeBefore: number, sizeAfter: number): number {
  if (sizeBefore === 0) return 0;
  return Math.max(0, (sizeBefore - sizeAfter) / sizeBefore);
}

// ────────────────────────────────────────────────────────────────────────────
// NodeIO インスタンスファクトリ
// ────────────────────────────────────────────────────────────────────────────

/**
 * KHRDracoMeshCompression を登録した NodeIO インスタンスを返す。
 * テスト時に差し替えできるようファクトリ関数として切り出す。
 */
function createNodeIO(): NodeIO {
  return new NodeIO().registerExtensions([KHRDracoMeshCompression]);
}

// ────────────────────────────────────────────────────────────────────────────
// 主処理
// ────────────────────────────────────────────────────────────────────────────

/**
 * GLB / glTF ファイルを読み込み、最適化して GLB バッファとして返す。
 *
 * @param absolutePath  入力ファイルの絶対パス（.glb または .gltf）
 * @param options       最適化オプション
 * @returns             最適化済み GLB バッファと統計情報
 */
export async function optimizeGlb(
  absolutePath: string,
  options: OptimizeOptions = {}
): Promise<OptimizeResult> {
  const {
    draco: useDraco = true,
    prune: usePrune = true,
    dedup: useDedup = true,
    dracoOptions = {},
  } = options;

  // 入力バッファを読む（サイズ計測のため）
  const inputBuffer = readFileSync(absolutePath);
  const sizeBefore = inputBuffer.length;

  const io = createNodeIO();

  // ファイル拡張子を判定して適切なメソッドで読み込む
  const ext = extname(absolutePath).toLowerCase();
  let document;
  if (ext === '.glb') {
    document = await io.readBinary(inputBuffer);
  } else {
    // .gltf はファイルパスで読む（.bin / テクスチャが同ディレクトリにある）
    document = await io.read(absolutePath);
  }

  // 変換パイプラインを構築
  const transforms = [];

  if (useDedup) {
    transforms.push(dedup());
  }

  if (usePrune) {
    transforms.push(prune());
  }

  if (useDraco) {
    // draco3dgltf の encoder モジュールを初期化し、NodeIO に登録する
    // draco() 自体には encoder オプションはない — io.registerDependencies() 経由で渡す
    const dracoEncoder = await createEncoderModule();
    io.registerDependencies({ 'draco3d.encoder': dracoEncoder });
    transforms.push(draco({ ...dracoOptions }));
  }

  // 変換を適用
  await document.transform(...transforms);

  // GLB として書き出し
  const outputBuffer = Buffer.from(await io.writeBinary(document));
  const sizeAfter = outputBuffer.length;
  const reductionRatio = computeReductionRatio(sizeBefore, sizeAfter);

  return { buffer: outputBuffer, sizeBefore, sizeAfter, reductionRatio };
}

/**
 * GLB / glTF ファイルを最適化してバッファと統計ログを返す。
 * ログは呼び出し元が console.log する。
 *
 * @param absolutePath  入力ファイルの絶対パス
 * @param options       最適化オプション（enabled=false でスキップ）
 * @returns             最適化済みバッファ（スキップ時は null）と統計ログ文字列
 */
export async function optimizeAsset(
  absolutePath: string,
  options: OptimizeOptions & { enabled?: boolean } = {}
): Promise<{ buffer: Buffer | null; logLine: string }> {
  const enabled = options.enabled !== false;
  const filename = basename(absolutePath);

  if (!enabled) {
    return {
      buffer: null,
      logLine: formatOptimizeSkipLog(filename),
    };
  }

  const result = await optimizeGlb(absolutePath, options);
  const logLine = formatOptimizeLog(
    filename,
    result.sizeBefore,
    result.sizeAfter,
    result.reductionRatio
  );

  return { buffer: result.buffer, logLine };
}
