import type { DeployManifest, AssetEntry } from '@static3d/types';
import type { HashedAsset } from './hash.js';
import { lookup } from 'mime-types';

export function generateManifest(
  assets: HashedAsset[],
  cdnBaseUrl: string,
  version: string,
  dependencyMap: Map<string, string[]>
): DeployManifest {
  const entries: Record<string, AssetEntry> = {};

  for (const asset of assets) {
    const contentType = lookup(asset.key) || 'application/octet-stream';
    const url = `${cdnBaseUrl}/${asset.hashedKey}`;

    const entry: AssetEntry = {
      url,
      size: asset.size,
      hash: asset.hash,
      contentType,
    };

    const deps = dependencyMap.get(asset.key);
    if (deps && deps.length > 0) {
      entry.dependencies = deps;
    }

    entries[asset.key] = entry;
  }

  return {
    schemaVersion: 1,
    version,
    buildTime: new Date().toISOString(),
    assets: entries,
  };
}
