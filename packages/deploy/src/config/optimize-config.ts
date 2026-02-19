/**
 * optimize-config.ts
 *
 * deploy パッケージローカルの最適化設定型。
 * @static3d/types を変更せずに static3d.config.json の
 * "optimize" フィールドを型安全に扱うための拡張型を定義する。
 *
 * static3d.config.json への追加例:
 *   {
 *     "schemaVersion": 1,
 *     "project": "my-cake-shop",
 *     "optimize": {
 *       "enabled": true,
 *       "draco": true,
 *       "prune": true,
 *       "dedup": true
 *     },
 *     "deploy": { ... }
 *   }
 */

/** static3d.config.json の "optimize" セクション */
export interface OptimizeConfig {
  /** 最適化を有効にする（デフォルト: false） */
  enabled?: boolean;
  /** Draco 圧縮（デフォルト: true） */
  draco?: boolean;
  /** 未使用リソース prune（デフォルト: true） */
  prune?: boolean;
  /** 重複データ dedup（デフォルト: true） */
  dedup?: boolean;
  /**
   * Draco 圧縮の詳細パラメーター（省略時は @gltf-transform のデフォルト）
   * encodeSpeed / decodeSpeed: 0 (高圧縮) 〜 10 (高速)
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

/**
 * @static3d/types の Static3dConfig を "optimize" フィールドで拡張した型。
 * loadConfig() の戻り値をこの型にキャストして使う。
 */
export interface Static3dConfigWithOptimize {
  schemaVersion: 1;
  project: string;
  /** 最適化パイプライン設定（省略時: 最適化スキップ） */
  optimize?: OptimizeConfig;
  /** デプロイ設定 */
  deploy?: Record<string, unknown>;
  /** ディスプレイ設定 */
  display?: Record<string, unknown>;
  /** ドラフト設定 */
  draft?: Record<string, unknown>;
}

/**
 * static3d.config.json から optimize セクションを取得する。
 * @param config  loadConfig() で読み込んだ設定オブジェクト
 * @returns       OptimizeConfig（なければ undefined）
 */
export function extractOptimizeConfig(
  config: Record<string, unknown>
): OptimizeConfig | undefined {
  const raw = config['optimize'];
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw !== 'object') return undefined;
  return raw as OptimizeConfig;
}
