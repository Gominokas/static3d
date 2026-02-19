/**
 * @static3d/deploy — main entry point
 *
 * CLI 以外から直接インポートできる公開 API をエクスポートする。
 */

// ビルドパイプライン
export { build } from './build/index.js';

// 設定ローダー / バリデーター
export { loadConfig, validateDeployConfig, ConfigError } from './config/schema.js';

// R2 アップロード / Pages デプロイ
export { uploadToR2 } from './push/r2.js';
export { deployToPages } from './push/pages.js';
export { push } from './push/index.js';

// 型
export type { CollectedAsset } from './build/collect.js';
export type { HashedAsset } from './build/hash.js';
