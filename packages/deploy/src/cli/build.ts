import { loadConfig, validateDeployConfig } from '../config/schema.js';
import { build } from '../build/index.js';

export interface BuildCommandOptions {
  configPath?: string;
}

export async function buildCommand(opts: BuildCommandOptions = {}): Promise<void> {
  try {
    const config = loadConfig(opts.configPath);
    const deployConfig = validateDeployConfig(config);
    await build(deployConfig);
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }
    process.exit(1);
  }
}
