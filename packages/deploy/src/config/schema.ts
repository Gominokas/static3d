import type { Static3dConfig, DeployConfig } from '@static3d/types';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export class ConfigError extends Error {
  constructor(message: string) {
    super(`[CONFIG] ${message}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(configPath?: string): Static3dConfig {
  const resolved = resolve(configPath ?? 'static3d.config.json');

  if (!existsSync(resolved)) {
    throw new ConfigError(`Config file not found: ${resolved}`);
  }

  const raw = readFileSync(resolved, 'utf-8');
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError(`Invalid JSON in ${resolved}`);
  }

  return parsed as Static3dConfig;
}

export function validateDeployConfig(config: Static3dConfig): DeployConfig {
  if (!config.deploy) {
    throw new ConfigError('"deploy" section is required');
  }

  const d = config.deploy;

  if (!d.cdn?.baseUrl) {
    throw new ConfigError('deploy.cdn.baseUrl is required');
  }

  if (!d.cdn.baseUrl.startsWith('https://')) {
    throw new ConfigError('deploy.cdn.baseUrl must start with https://');
  }

  if (!d.cdn?.bucket) {
    throw new ConfigError('deploy.cdn.bucket is required');
  }

  if (!d.assets?.immediateDir) {
    throw new ConfigError('deploy.assets.immediateDir is required');
  }

  if (!d.assets?.deferredDir) {
    throw new ConfigError('deploy.assets.deferredDir is required');
  }

  if (!existsSync(resolve(d.assets.immediateDir))) {
    throw new ConfigError(
      `deploy.assets.immediateDir "${d.assets.immediateDir}" not found`
    );
  }

  if (!existsSync(resolve(d.assets.deferredDir))) {
    throw new ConfigError(
      `deploy.assets.deferredDir "${d.assets.deferredDir}" not found`
    );
  }

  return d;
}
