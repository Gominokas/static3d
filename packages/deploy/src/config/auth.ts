/**
 * 認証情報の解決
 *
 * ## 2種類の認証情報について
 *
 * ### R2 S3互換キー (CLOUDFLARE_R2_ACCESS_KEY_ID / SECRET_ACCESS_KEY)
 *   Cloudflare ダッシュボード → R2 → 右上「Manage R2 API Tokens」から発行する。
 *   これは通常の CLOUDFLARE_API_TOKEN とは**別物**。
 *   S3互換エンドポイント (https://<accountId>.r2.cloudflarestorage.com) に対して
 *   AWS SDK の Signature V4 認証で使う。
 *
 * ### Cloudflare API トークン (CLOUDFLARE_API_TOKEN)
 *   Cloudflare ダッシュボード → My Profile → API Tokens から発行する。
 *   Pages の REST API (https://api.cloudflare.com/client/v4/accounts/…) に使う。
 *   R2の S3互換API には使えない。
 *
 * ## 必要な権限
 *   R2 S3互換キー : 対象バケットへの読み書き権限
 *   API トークン  : Account:Cloudflare Pages:Edit
 *
 * ## 設定方法
 *   export CLOUDFLARE_ACCOUNT_ID=<your-account-id>
 *   export CLOUDFLARE_R2_ACCESS_KEY_ID=<r2-access-key-id>
 *   export CLOUDFLARE_R2_SECRET_ACCESS_KEY=<r2-secret-access-key>
 *   export CLOUDFLARE_API_TOKEN=<cf-api-token>
 *
 * config fileには認証情報を書かない。環境変数のみ。
 */

export interface R2Credentials {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** R2 S3互換エンドポイント */
  endpoint: string;
}

export interface PagesCredentials {
  apiToken: string;
  accountId: string;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(`[AUTH] ${message}`);
    this.name = 'AuthError';
  }
}

function requireEnv(name: string, hint?: string): string {
  const val = process.env[name];
  if (!val) {
    throw new AuthError(
      `Environment variable ${name} is required but not set.\n` +
        `  Set it with: export ${name}=<value>` +
        (hint ? `\n  ${hint}` : '')
    );
  }
  return val;
}

export function resolveR2Credentials(): R2Credentials {
  const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID');
  const accessKeyId = requireEnv(
    'CLOUDFLARE_R2_ACCESS_KEY_ID',
    'R2 S3互換キーは CF Dashboard → R2 → "Manage R2 API Tokens" から発行 (API Tokenとは別物)'
  );
  const secretAccessKey = requireEnv(
    'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
    'R2 S3互換キーは CF Dashboard → R2 → "Manage R2 API Tokens" から発行 (API Tokenとは別物)'
  );

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  };
}

export function resolvePagesCredentials(): PagesCredentials {
  const apiToken = requireEnv(
    'CLOUDFLARE_API_TOKEN',
    'CF Dashboard → My Profile → API Tokens から発行 (Pages:Edit 権限が必要)'
  );
  const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID');

  return { apiToken, accountId };
}
