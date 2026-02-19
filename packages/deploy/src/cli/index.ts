#!/usr/bin/env node

import { buildCommand } from './build.js';
import { pushCommand } from './push.js';
import { validateCommand } from './validate.js';

const args = process.argv.slice(2);
const command = args[0];
const subCommand = args[1];

// `static3d-deploy deploy build` と `static3d-deploy build` の両方をサポート
const effectiveCommand =
  command === 'deploy' && subCommand ? subCommand : command;

// フラグパーサー
function getFlag(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}
function hasFlag(flag: string): boolean {
  return args.includes(flag);
}

const configPath = getFlag('--config');
const projectName = getFlag('--project');
const skipCleanup = hasFlag('--skip-cleanup');
const skipPages = hasFlag('--skip-pages');

switch (effectiveCommand) {
  case 'build':
    buildCommand({ configPath });
    break;

  case 'push':
    pushCommand({ configPath, projectName, skipCleanup, skipPages });
    break;

  case 'validate':
    validateCommand({ configPath });
    break;

  default:
    console.log(`
static3d-deploy — Static 3D asset deployment tool

Usage:
  static3d-deploy build       Build assets (hash + manifest + gltf rewrite)
  static3d-deploy push        Deploy to Cloudflare (R2 + Pages)
  static3d-deploy validate    Validate config, assets, and env vars

Options:
  --config <path>      Path to static3d.config.json (default: ./static3d.config.json)
  --project <name>     Cloudflare Pages project name (default: config.project)
  --skip-cleanup       Skip old asset cleanup after push
  --skip-pages         Skip Pages deploy, upload to R2 only
`);
}
