/**
 * promote.test.ts — unit tests for the promote command
 *
 * Tests the pure utility functions only (no R2 I/O).
 * R2 operations are integration-tested manually.
 */
import { describe, it, expect } from 'vitest';

// ────────────────────────────────────────────────────────────────────────────
// resolveEnvironments
// ────────────────────────────────────────────────────────────────────────────

describe('resolveEnvironments', () => {
  it('returns default environments when none configured', async () => {
    const { resolveEnvironments } = await import('../cli/promote.js');
    const envs = resolveEnvironments({});
    expect(envs.draft).toEqual({ prefix: 'draft/' });
    expect(envs.staging).toEqual({ prefix: 'staging/' });
    expect(envs.production).toEqual({ prefix: '' });
  });

  it('returns configured environments', async () => {
    const { resolveEnvironments } = await import('../cli/promote.js');
    const envs = resolveEnvironments({
      environments: {
        custom: { prefix: 'custom/' },
        production: { prefix: '' },
      },
    });
    expect(envs.custom).toEqual({ prefix: 'custom/' });
    expect(envs.production).toEqual({ prefix: '' });
  });

  it('returns defaults when environments is not an object', async () => {
    const { resolveEnvironments } = await import('../cli/promote.js');
    const envs = resolveEnvironments({ environments: 'invalid' });
    expect(envs.draft).toBeDefined();
    expect(envs.staging).toBeDefined();
    expect(envs.production).toBeDefined();
  });

  it('production prefix is empty string', async () => {
    const { resolveEnvironments } = await import('../cli/promote.js');
    const envs = resolveEnvironments({});
    expect(envs.production.prefix).toBe('');
  });

  it('draft prefix ends with slash', async () => {
    const { resolveEnvironments } = await import('../cli/promote.js');
    const envs = resolveEnvironments({});
    expect(envs.draft.prefix.endsWith('/')).toBe(true);
  });

  it('staging prefix ends with slash', async () => {
    const { resolveEnvironments } = await import('../cli/promote.js');
    const envs = resolveEnvironments({});
    expect(envs.staging.prefix.endsWith('/')).toBe(true);
  });
});
