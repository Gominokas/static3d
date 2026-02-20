#!/usr/bin/env node

/**
 * CLI エントリーポイント。
 *
 * 最初に dotenv で .env をロードし、環境変数を process.env に注入する。
 * これにより毎回 $env:CLOUDFLARE_API_TOKEN=... を手打ちしなくて済む。
 */
import { config as loadDotenv } from 'dotenv';
loadDotenv(); // .env をプロセス起動時にロード（ファイルがなくても無視）

import { buildCommand } from './build.js';
import { pushCommand } from './push.js';
import { validateCommand } from './validate.js';
import { promoteCommand } from './promote.js';
import { admitCommand } from './admit.js';

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
const fromEnv = getFlag('--from');
const toEnv = getFlag('--to');

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

  case 'promote':
    promoteCommand({ configPath, from: fromEnv, to: toEnv });
    break;

  case 'admit':
    admitCommand({ configPath, from: fromEnv });
    break;

  default:
    console.log(`
static3d — Static 3D asset deployment tool

Usage:
  static3d admit              環境 → ローカルにアセット取得
  static3d build              ローカルでビルド（hash + manifest + gltf rewrite）
  static3d push               Cloudflare へデプロイ（R2 + Pages）
  static3d promote            環境間でアセット移動
  static3d validate           設定・アセット・環境変数を検証

Options:
  --config <path>      Path to static3d.config.json (default: ./static3d.config.json)
  --project <name>     Cloudflare Pages project name (default: config.project)
  --skip-cleanup       Skip old asset cleanup after push
  --skip-pages         Skip Pages deploy, upload to R2 only
  --from <env>         Source environment (admit/promote): local|draft|staging|production
  --to   <env>         Target environment (promote): draft|staging|production
`);
}
