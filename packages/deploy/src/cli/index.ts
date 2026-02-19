#!/usr/bin/env node

import { buildCommand } from './build.js';

const args = process.argv.slice(2);
const command = args[0];
const subCommand = args[1];

// `static3d-deploy deploy build` と `static3d-deploy build` の両方をサポート
const effectiveCommand =
  command === 'deploy' && subCommand ? subCommand : command;

const configFlagIndex = args.indexOf('--config');
const configPath =
  configFlagIndex !== -1 ? args[configFlagIndex + 1] : undefined;

switch (effectiveCommand) {
  case 'build':
    buildCommand(configPath);
    break;
  case 'push':
    console.log('[TODO] push command — Cloudflare R2 + Pages deploy');
    break;
  case 'validate':
    console.log('[TODO] validate command');
    break;
  default:
    console.log(`
static3d-deploy — Static 3D asset deployment tool

Usage:
  static3d-deploy build     Build assets (hash + manifest + gltf rewrite)
  static3d-deploy push      Deploy to Cloudflare (R2 + Pages)  [TODO]
  static3d-deploy validate  Validate config and assets          [TODO]

Options:
  --config <path>  Path to static3d.config.json (default: ./static3d.config.json)
`);
}
