import type { DeployManifest } from '@static3d/types';
import type { S3Client } from '@aws-sdk/client-s3';
import { listAllR2Keys, deleteFromR2 } from './r2.js';

export interface CleanupResult {
  deleted: string[];
  retained: string[];
  /** プレフィックス外のキー（別プロジェクト等）— 触らない */
  outOfScope: string[];
}

/**
 * cdnBaseUrl から R2 キーのプレフィックスを導出する。
 *
 * 例:
 *   https://cdn.example.com            → '' (バケット直下)
 *   https://cdn.example.com/           → ''
 *   https://cdn.example.com/v2         → 'v2/'
 *   https://cdn.example.com/proj/v2/   → 'proj/v2/'
 *
 * ベースURLにパス部分がある場合（サブパスCDN構成）はそれをプレフィックスとして使う。
 * バケット直下の場合は空文字列。
 */
export function extractKeyPrefix(cdnBaseUrl: string): string {
  const url = new URL(cdnBaseUrl);
  // pathname は "/" か "/some/path" の形式
  const path = url.pathname.replace(/^\//, '').replace(/\/$/, '');
  return path ? path + '/' : '';
}

/**
 * R2バケット内の旧世代アセットを削除する。
 *
 * 安全設計:
 *   - cdnBaseUrl のパスプレフィックスに一致するキーのみを操作対象にする。
 *   - プレフィックス外のキー（別プロジェクト・別用途）は一切触らない。
 *
 * ロジック:
 *   1. R2 の全オブジェクトキーを取得
 *   2. prefix でフィルタ（スコープ外は outOfScope に分類して無視）
 *   3. 現マニフェストのキー = 「現世代」(削除しない)
 *   4. スコープ内かつ現世代でない = 「旧世代」→ 削除
 *
 * TODO(Phase 2): oldVersionRetention > 0 の多世代保持。
 *   現状は retention > 0 のとき削除をスキップし警告のみ。
 *   実装方針: R2 オブジェクトメタデータに deployedAt を記録し、
 *             最新 N 世代のキーセットを保持して残りを削除する。
 */
export async function cleanupOldAssets(
  s3: S3Client,
  bucket: string,
  currentManifest: DeployManifest,
  cdnBaseUrl: string,
  retention: number = 0
): Promise<CleanupResult> {
  if (retention > 0) {
    console.log(
      `[CLEANUP] oldVersionRetention=${retention} — deletion skipped` +
        ` (multi-version retention not yet implemented)`
    );
    return { deleted: [], retained: [], outOfScope: [] };
  }

  // cdnBaseUrl のパス部分をプレフィックスとして使う
  const prefix = extractKeyPrefix(cdnBaseUrl);

  // 現マニフェストのアセット URL → R2 キー を逆引き
  // URL: https://cdn.example.com[/prefix]/hashedKey
  // → R2 key: [prefix/]hashedKey
  const currentKeys = new Set(
    Object.values(currentManifest.assets).map((a) => {
      const url = new URL(a.url);
      // pathname: /[prefix/]hashedKey → prefix/hashedKey (先頭スラッシュ除去)
      return url.pathname.replace(/^\//, '');
    })
  );

  const allKeys = await listAllR2Keys(s3, bucket);

  const toDelete: string[] = [];
  const retained: string[] = [];
  const outOfScope: string[] = [];

  for (const key of allKeys) {
    // プレフィックス外のキーは別プロジェクトの可能性があるので絶対に触らない
    if (prefix && !key.startsWith(prefix)) {
      outOfScope.push(key);
      continue;
    }

    if (currentKeys.has(key)) {
      retained.push(key);
    } else {
      toDelete.push(key);
    }
  }

  if (outOfScope.length > 0) {
    console.log(
      `[CLEANUP] ${outOfScope.length} key(s) outside prefix "${prefix}" — skipped (not owned by this project)`
    );
  }

  if (toDelete.length === 0) {
    console.log('[CLEANUP] No old assets to delete');
    return { deleted: [], retained, outOfScope };
  }

  console.log(`[CLEANUP] Deleting ${toDelete.length} old asset(s) with prefix "${prefix}"...`);
  await deleteFromR2(s3, bucket, toDelete);

  return { deleted: toDelete, retained, outOfScope };
}
