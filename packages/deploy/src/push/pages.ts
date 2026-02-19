import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { glob } from 'glob';
import type { PagesCredentials } from '../config/auth.js';

const CF_API = 'https://api.cloudflare.com/client/v4';

export interface PagesDeployResult {
  deploymentId: string;
  url: string;
  environment: string;
}

export class PagesError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number
  ) {
    super(`[PAGES] ${message}`);
    this.name = 'PagesError';
  }
}

/**
 * Pages プロジェクトが存在するか確認し、なければ作成する
 */
async function ensurePagesProject(
  creds: PagesCredentials,
  projectName: string
): Promise<void> {
  const res = await fetch(
    `${CF_API}/accounts/${creds.accountId}/pages/projects/${projectName}`,
    {
      headers: {
        Authorization: `Bearer ${creds.apiToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (res.status === 404) {
    // プロジェクト作成
    const createRes = await fetch(
      `${CF_API}/accounts/${creds.accountId}/pages/projects`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: projectName,
          production_branch: 'main',
        }),
      }
    );

    if (!createRes.ok) {
      const body = await createRes.text();
      throw new PagesError(
        `Failed to create project "${projectName}": ${createRes.status} ${body}`,
        createRes.status
      );
    }

    console.log(`[PAGES] Created project: ${projectName}`);
    return;
  }

  if (!res.ok) {
    const body = await res.text();
    throw new PagesError(
      `Failed to check project "${projectName}": ${res.status} ${body}`,
      res.status
    );
  }
}

/**
 * dist/pages/ を Cloudflare Pages に Direct Upload でデプロイする。
 *
 * フロー:
 *   1. deployment を作成 (multipart/form-data で全ファイルを送信)
 *   2. デプロイIDと公開URLを返す
 */
export async function deployToPages(
  creds: PagesCredentials,
  projectName: string,
  pagesOutputDir: string
): Promise<PagesDeployResult> {
  const pagesDir = resolve(pagesOutputDir);

  await ensurePagesProject(creds, projectName);

  console.log(`[PAGES] Deploying ${pagesDir} to project "${projectName}"...`);

  // dist/pages 以下の全ファイルを収集
  const files = await glob('**/*', {
    cwd: pagesDir,
    nodir: true,
    absolute: false,
  });

  if (files.length === 0) {
    throw new PagesError(`No files found in ${pagesDir}`);
  }

  // multipart/form-data でまとめて送信
  const formData = new FormData();

  for (const file of files) {
    const absPath = join(pagesDir, file);
    const content = readFileSync(absPath);
    const blob = new Blob([content]);
    // Cloudflare Pages API は / 始まりのパスを要求する
    const pagePath = '/' + file.replace(/\\/g, '/');
    formData.append('files', blob, pagePath);
  }

  const res = await fetch(
    `${CF_API}/accounts/${creds.accountId}/pages/projects/${projectName}/deployments`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.apiToken}`,
        // Content-Type は FormData が自動設定するので指定しない
      },
      body: formData,
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new PagesError(
      `Deployment failed: ${res.status} ${body}`,
      res.status
    );
  }

  const data = (await res.json()) as {
    result: {
      id: string;
      url: string;
      environment: string;
      aliases?: string[];
    };
  };

  const result = data.result;
  const url = result.aliases?.[0] ?? result.url;

  console.log(`[PAGES] ✓ Deployed: ${url}`);
  console.log(`[PAGES]   Deployment ID: ${result.id}`);

  return {
    deploymentId: result.id,
    url,
    environment: result.environment,
  };
}
