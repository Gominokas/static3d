import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeDiff } from '../push/diff.js';
import type { S3Client } from '@aws-sdk/client-s3';

// S3ClientのListObjectsV2をモックする
function makeS3Mock(existingKeys: string[]): S3Client {
  return {
    send: vi.fn().mockImplementation((cmd: { input: { ContinuationToken?: string } }) => {
      return Promise.resolve({
        Contents: existingKeys.map((Key) => ({ Key })),
        NextContinuationToken: undefined,
      });
    }),
  } as unknown as S3Client;
}

describe('diff', () => {
  it('identifies files to upload and files already existing', async () => {
    const s3 = makeS3Mock(['models/scene.abc12345.gltf', 'textures/albedo.deadbeef.png']);

    const localKeys = [
      'models/scene.abc12345.gltf',       // 既存 → スキップ
      'textures/albedo.deadbeef.png',     // 既存 → スキップ
      'textures/normal.cafebabe.png',     // 新規 → アップロード
      'models/env.00001111.hdr',          // 新規 → アップロード
    ];

    const result = await computeDiff(s3, 'test-bucket', localKeys);

    expect(result.toUpload).toHaveLength(2);
    expect(result.toUpload).toContain('textures/normal.cafebabe.png');
    expect(result.toUpload).toContain('models/env.00001111.hdr');

    expect(result.alreadyExists).toHaveLength(2);
    expect(result.alreadyExists).toContain('models/scene.abc12345.gltf');
    expect(result.alreadyExists).toContain('textures/albedo.deadbeef.png');
  });

  it('treats empty R2 bucket as all-new upload', async () => {
    const s3 = makeS3Mock([]);
    const localKeys = ['a.abc12345.glb', 'b.deadbeef.png'];

    const result = await computeDiff(s3, 'test-bucket', localKeys);

    expect(result.toUpload).toHaveLength(2);
    expect(result.alreadyExists).toHaveLength(0);
  });

  it('treats empty local as nothing to upload', async () => {
    const s3 = makeS3Mock(['old.abc12345.glb']);
    const result = await computeDiff(s3, 'test-bucket', []);

    expect(result.toUpload).toHaveLength(0);
    expect(result.alreadyExists).toHaveLength(0);
  });
});
