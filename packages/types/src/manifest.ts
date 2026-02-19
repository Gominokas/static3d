export interface AssetEntry {
  /** CDN上の完全URL */
  url: string;
  /** ファイルサイズ（バイト） */
  size: number;
  /** "sha256:<hex64>" 形式 */
  hash: string;
  /** MIMEタイプ */
  contentType: string;
  /** .gltfの場合、参照する外部ファイルのキー一覧 */
  dependencies?: string[];
}

export interface DeployManifest {
  /** マニフェストスキーマバージョン */
  schemaVersion: 1;
  /** ビルドID（Git short SHA またはタイムスタンプ） */
  version: string;
  /** ビルド日時（ISO 8601） */
  buildTime: string;
  /** アセット一覧（キーは deferredDir からの相対パス） */
  assets: Record<string, AssetEntry>;
}
