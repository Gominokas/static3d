import { loadConfig, validateDeployConfig } from '../config/schema.js';
import { push } from '../push/index.js';

export interface PushCommandOptions {
  configPath?: string;
  projectName?: string;
  skipCleanup?: boolean;
  skipPages?: boolean;
}

export async function pushCommand(opts: PushCommandOptions = {}): Promise<void> {
  try {
    const config = loadConfig(opts.configPath);
    const deployConfig = validateDeployConfig(config);

    const projectName = opts.projectName ?? config.project;
    if (!projectName) {
      console.error('[CONFIG] "project" is required in static3d.config.json');
      process.exit(1);
    }

    await push(deployConfig, projectName, {
      skipCleanup: opts.skipCleanup,
      skipPages: opts.skipPages,
    });
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }
    process.exit(1);
  }
}
