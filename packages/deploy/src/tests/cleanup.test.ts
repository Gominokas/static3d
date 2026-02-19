import { describe, it, expect, vi } from 'vitest';
import { cleanupOldAssets, extractKeyPrefix } from '../push/cleanup.js';
import type { DeployManifest } from '@static3d/types';
import type { S3Client } from '@aws-sdk/client-s3';

function makeManifest(cdnBase: string, hashedKeys: string[]): DeployManifest {
  const assets: DeployManifest['assets'] = {};
  for (const key of hashedKeys) {
    const originalKey = key.replace(/\.[0-9a-f]{8,16}(\.[^.]+)$/, '$1');
    assets[originalKey] = {
      url: `${cdnBase}/${key}`,
      size: 100,
      hash: 'sha256:' + 'a'.repeat(64),
      contentType: 'application/octet-stream',
    };
  }
  return {
    schemaVersion: 1,
    version: 'abc1234',
    buildTime: new Date().toISOString(),
    assets,
  };
}

function makeS3Mock(allKeys: string[], deletedKeys: string[] = []): S3Client {
  return {
    send: vi.fn().mockImplementation((cmd: unknown) => {
      const cmdName = (cmd as { constructor: { name: string } }).constructor.name;
      if (cmdName === 'ListObjectsV2Command') {
        return Promise.resolve({
          Contents: allKeys.map((Key) => ({ Key })),
          NextContinuationToken: undefined,
        });
      }
      if (cmdName === 'DeleteObjectsCommand') {
        const input = (cmd as { input: { Delete: { Objects: { Key: string }[] } } }).input;
        deletedKeys.push(...input.Delete.Objects.map((o) => o.Key));
        return Promise.resolve({});
      }
      return Promise.resolve({});
    }),
  } as unknown as S3Client;
}

const CDN_BASE = 'https://cdn.example.com';

describe('extractKeyPrefix', () => {
  it('returns empty string for bare origin URL', () => {
    expect(extractKeyPrefix('https://cdn.example.com')).toBe('');
    expect(extractKeyPrefix('https://cdn.example.com/')).toBe('');
  });

  it('returns prefix with trailing slash for single-segment path', () => {
    expect(extractKeyPrefix('https://cdn.example.com/v2')).toBe('v2/');
    expect(extractKeyPrefix('https://cdn.example.com/v2/')).toBe('v2/');
  });

  it('returns full prefix for multi-segment path', () => {
    expect(extractKeyPrefix('https://cdn.example.com/proj/v2')).toBe('proj/v2/');
    expect(extractKeyPrefix('https://cdn.example.com/a/b/c/')).toBe('a/b/c/');
  });
});

describe('cleanup', () => {
  it('deletes old keys within prefix, retains current keys', async () => {
    const currentKeys = ['models/scene.abc12345.gltf', 'textures/albedo.deadbeef.png'];
    const oldKeys = ['models/scene.00000000.gltf', 'textures/albedo.11111111.png'];
    const allR2Keys = [...currentKeys, ...oldKeys];

    const manifest = makeManifest(CDN_BASE, currentKeys);
    const s3 = makeS3Mock(allR2Keys);

    const result = await cleanupOldAssets(s3, 'test-bucket', manifest, CDN_BASE, 0);

    expect(result.deleted).toHaveLength(2);
    expect(result.deleted).toContain('models/scene.00000000.gltf');
    expect(result.deleted).toContain('textures/albedo.11111111.png');
    expect(result.retained).toHaveLength(2);
    expect(result.outOfScope).toHaveLength(0);
  });

  it('retains all keys when all are current', async () => {
    const currentKeys = ['models/scene.abc12345.gltf'];
    const manifest = makeManifest(CDN_BASE, currentKeys);
    const s3 = makeS3Mock(currentKeys);

    const result = await cleanupOldAssets(s3, 'test-bucket', manifest, CDN_BASE, 0);

    expect(result.deleted).toHaveLength(0);
    expect(result.retained).toHaveLength(1);
  });

  it('skips deletion when retention > 0', async () => {
    const currentKeys = ['models/scene.abc12345.gltf'];
    const manifest = makeManifest(CDN_BASE, currentKeys);
    const s3 = makeS3Mock(['models/scene.abc12345.gltf', 'models/scene.old00000.gltf']);

    const result = await cleanupOldAssets(s3, 'test-bucket', manifest, CDN_BASE, 3);

    expect(result.deleted).toHaveLength(0);
    expect(result.outOfScope).toHaveLength(0);
  });

  it('never touches keys outside of cdnBaseUrl prefix', async () => {
    // バケットを別プロジェクトと共有している状況
    // CDN: https://cdn.example.com/project-a
    // R2キー形式: project-a/<hashedKey>
    const cdnBase = 'https://cdn.example.com/project-a';

    // makeManifest は cdnBase + '/' + hashedKey で URL を作る。
    // extractKeyPrefix('https://cdn.example.com/project-a') → 'project-a/'
    // cleanupOldAssets の URL逆引きは pathname の先頭 '/' を除去するだけなので
    // URL: https://cdn.example.com/project-a/models/scene.abc12345.gltf
    // → pathname: /project-a/models/scene.abc12345.gltf
    // → key: project-a/models/scene.abc12345.gltf  ← R2上の実際のキー
    const currentHashedKey = 'project-a/models/scene.abc12345.gltf';
    const otherProjectKeys = [
      'project-b/models/other.deadbeef.glb',  // 別プロジェクト → 絶対触らない
      'project-b/textures/tex.cafebabe.png',
    ];
    const oldKey = 'project-a/models/scene.00000000.gltf'; // 旧世代 → 削除対象

    const allR2Keys = [currentHashedKey, oldKey, ...otherProjectKeys];

    // makeManifest: assets[originalKey].url = cdnBase + '/' + hashedKey
    // = 'https://cdn.example.com/project-a/project-a/models/scene.abc12345.gltf' では困る。
    // URL逆引きロジックに合わせて、manifest を直接組み立てる。
    const manifest: DeployManifest = {
      schemaVersion: 1,
      version: 'test',
      buildTime: new Date().toISOString(),
      assets: {
        'models/scene.gltf': {
          // URL の pathname = /project-a/models/scene.abc12345.gltf → key = project-a/models/scene.abc12345.gltf
          url: `https://cdn.example.com/${currentHashedKey}`,
          size: 100,
          hash: 'sha256:' + 'a'.repeat(64),
          contentType: 'model/gltf+json',
        },
      },
    };

    const s3 = makeS3Mock(allR2Keys);

    const result = await cleanupOldAssets(s3, 'test-bucket', manifest, cdnBase, 0);

    // 旧世代のみ削除
    expect(result.deleted).toHaveLength(1);
    expect(result.deleted).toContain('project-a/models/scene.00000000.gltf');

    // 別プロジェクトのキーは outOfScope に分類され削除されない
    expect(result.outOfScope).toHaveLength(2);
    expect(result.outOfScope).toContain('project-b/models/other.deadbeef.glb');
    expect(result.outOfScope).toContain('project-b/textures/tex.cafebabe.png');
  });

  it('handles bare-origin CDN URL (no prefix) without touching unrelated keys', async () => {
    // プレフィックスなしの場合、バケット内の全キーがスコープ内になる
    // (バケット1プロジェクト専用の構成)
    const currentKeys = ['scene.abc12345.gltf'];
    const oldKeys = ['scene.00000000.gltf'];
    const manifest = makeManifest(CDN_BASE, currentKeys);
    const s3 = makeS3Mock([...currentKeys, ...oldKeys]);

    const result = await cleanupOldAssets(s3, 'test-bucket', manifest, CDN_BASE, 0);

    expect(result.deleted).toContain('scene.00000000.gltf');
    expect(result.outOfScope).toHaveLength(0);
  });
});
