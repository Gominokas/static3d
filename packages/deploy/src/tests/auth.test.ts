import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveR2Credentials, resolvePagesCredentials, AuthError } from '../config/auth.js';

describe('auth', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // テスト前に関連env varをクリア
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
    delete process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
    delete process.env.CLOUDFLARE_API_TOKEN;
  });

  afterEach(() => {
    // テスト後に元に戻す
    process.env = { ...originalEnv };
  });

  describe('resolveR2Credentials', () => {
    it('resolves credentials from env vars', () => {
      process.env.CLOUDFLARE_ACCOUNT_ID = 'abc123';
      process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = 'key-id';
      process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = 'secret-key';

      const creds = resolveR2Credentials();

      expect(creds.accountId).toBe('abc123');
      expect(creds.accessKeyId).toBe('key-id');
      expect(creds.secretAccessKey).toBe('secret-key');
      expect(creds.endpoint).toBe('https://abc123.r2.cloudflarestorage.com');
    });

    it('throws AuthError when CLOUDFLARE_ACCOUNT_ID is missing', () => {
      process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = 'key-id';
      process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = 'secret-key';

      expect(() => resolveR2Credentials()).toThrow(AuthError);
      expect(() => resolveR2Credentials()).toThrow('CLOUDFLARE_ACCOUNT_ID');
    });

    it('throws AuthError when R2 access key is missing', () => {
      process.env.CLOUDFLARE_ACCOUNT_ID = 'abc123';
      process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = 'secret-key';

      expect(() => resolveR2Credentials()).toThrow(AuthError);
      expect(() => resolveR2Credentials()).toThrow('CLOUDFLARE_R2_ACCESS_KEY_ID');
    });

    it('constructs correct R2 endpoint URL', () => {
      process.env.CLOUDFLARE_ACCOUNT_ID = 'myaccount';
      process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = 'key';
      process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = 'secret';

      const { endpoint } = resolveR2Credentials();
      expect(endpoint).toBe('https://myaccount.r2.cloudflarestorage.com');
    });
  });

  describe('resolvePagesCredentials', () => {
    it('resolves credentials from env vars', () => {
      process.env.CLOUDFLARE_API_TOKEN = 'token-xyz';
      process.env.CLOUDFLARE_ACCOUNT_ID = 'acc-123';

      const creds = resolvePagesCredentials();
      expect(creds.apiToken).toBe('token-xyz');
      expect(creds.accountId).toBe('acc-123');
    });

    it('throws AuthError when API token is missing', () => {
      process.env.CLOUDFLARE_ACCOUNT_ID = 'acc-123';

      expect(() => resolvePagesCredentials()).toThrow(AuthError);
      expect(() => resolvePagesCredentials()).toThrow('CLOUDFLARE_API_TOKEN');
    });
  });
});
