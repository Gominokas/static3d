import { loadConfig, validateDeployConfig } from '../config/schema.js';
import { build } from '../build/index.js';
import { extractOptimizeConfig } from '../config/optimize-config.js';

export interface BuildCommandOptions {
  configPath?: string;
}

export async function buildCommand(opts: BuildCommandOptions = {}): Promise<void> {
  try {
    const config = loadConfig(opts.configPath);
    const deployConfig = validateDeployConfig(config);
    const optimizeConfig = extractOptimizeConfig(config as unknown as Record<string, unknown>);
    await build(deployConfig, undefined, optimizeConfig);
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }
    process.exit(1);
  }
}
