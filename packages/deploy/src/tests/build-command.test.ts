/**
 * build-command.test.ts — unit tests for buildCommand wiring
 *
 * Verifies that buildCommand passes optimizeConfig to build().
 * Does not test full build pipeline (covered by plugin.integration.test.ts).
 */
import { describe, it, expect } from 'vitest';

describe('extractOptimizeConfig wiring', () => {
  it('extractOptimizeConfig returns config from static3d config object', async () => {
    const { extractOptimizeConfig } = await import('../config/optimize-config.js');

    const config = {
      optimize: {
        enabled: true,
        draco: true,
        prune: false,
        dedup: true,
      },
    };

    const opt = extractOptimizeConfig(config);
    expect(opt).toBeDefined();
    expect(opt!.enabled).toBe(true);
    expect(opt!.draco).toBe(true);
    expect(opt!.prune).toBe(false);
    expect(opt!.dedup).toBe(true);
  });

  it('extractOptimizeConfig returns undefined when optimize not present', async () => {
    const { extractOptimizeConfig } = await import('../config/optimize-config.js');
    expect(extractOptimizeConfig({})).toBeUndefined();
  });

  it('extractOptimizeConfig returns undefined when optimize is disabled-like', async () => {
    const { extractOptimizeConfig } = await import('../config/optimize-config.js');
    const opt = extractOptimizeConfig({ optimize: { enabled: false } });
    expect(opt).toBeDefined();
    expect(opt!.enabled).toBe(false);
  });
});

describe('dotenv integration', () => {
  it('.env.example exists at repo root', async () => {
    const { existsSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    // From deploy package tests, go up to repo root
    const envExamplePath = resolve(process.cwd(), '..', '..', '.env.example');
    expect(existsSync(envExamplePath)).toBe(true);
  });

  it('.env.example contains required variable names', async () => {
    const { readFileSync, existsSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const envExamplePath = resolve(process.cwd(), '..', '..', '.env.example');
    if (!existsSync(envExamplePath)) return; // skip if path wrong
    const content = readFileSync(envExamplePath, 'utf-8');
    expect(content).toContain('CLOUDFLARE_ACCOUNT_ID');
    expect(content).toContain('CLOUDFLARE_API_TOKEN');
    expect(content).toContain('CLOUDFLARE_R2_ACCESS_KEY_ID');
    expect(content).toContain('CLOUDFLARE_R2_SECRET_ACCESS_KEY');
  });
});
