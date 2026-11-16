/**
 * test.ts — static3d Local Test
 *
 * AssetLoader を使って manifest.json を読み込み、全アセットを取得する
 * ブラウザ動作確認スクリプト。
 *
 * Vite dev server 上で実行:
 *   pnpm vite
 *   → http://localhost:5173
 */

import { AssetLoader } from './packages/display/src/loader/AssetLoader.js';

// ─── DOM helpers ─────────────────────────────────────────────────────────────

const logEl = document.getElementById('log') as HTMLPreElement;
const progressEl = document.getElementById('progress') as HTMLDivElement;

function updateProgress(pct: number, label: string): void {
  const bar = progressEl.querySelector('.bar') as HTMLDivElement;
  const lbl = progressEl.querySelector('.label') as HTMLSpanElement;
  if (bar) bar.style.width = `${Math.round(pct)}%`;
  if (lbl) lbl.textContent = label;
}

function log(
  message: string,
  cls: 'info' | 'warn' | 'error' | 'ok' | 'dim' | '' = ''
): void {
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  const prefix = `[${ts}] `;
  const line = document.createElement('span');
  if (cls) line.className = cls;
  line.textContent = prefix + message + '\n';
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
  // Also write to devtools console
  if (cls === 'error') console.error(message);
  else if (cls === 'warn') console.warn(message);
  else console.log(message);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log('static3d local test starting…', 'dim');
  updateProgress(0, 'Connecting…');

  // 1. Construct the AssetLoader pointing at /manifest.json (served by Vite)
  const loader = new AssetLoader('/manifest.json', {
    concurrency: 2,
    retryCount: 2,
    timeout: 10_000,
    integrity: true,
  });

  // 2. Register progress callback
  loader.onProgress((evt) => {
    const pct = evt.total > 0 ? (evt.loaded / evt.total) * 100 : 0;
    const label = `${evt.completedCount}/${evt.totalCount} assets  (${
      evt.loaded
    } / ${evt.total} bytes)`;
    updateProgress(pct, label);
    log(
      `  ↳ progress: ${evt.asset}  ${evt.completedCount}/${evt.totalCount}`,
      'dim'
    );
  });

  // 3. Register error callback
  loader.onError((err) => {
    log(
      `ERROR [${err.type}] ${err.key}  ${err.url}${
        err.cause ? '  →  ' + err.cause.message : ''
      }`,
      'error'
    );
  });

  // 4. Load manifest
  log('init() — fetching manifest.json …', 'info');
  try {
    await loader.init();
  } catch (err) {
    log(`Failed to fetch manifest: ${(err as Error).message}`, 'error');
    updateProgress(0, 'Error – see log');
    return;
  }

  const manifest = loader.getManifest();
  if (!manifest) {
    log('manifest is null after init()', 'error');
    return;
  }

  const assetKeys = Object.keys(manifest.assets);
  log(`manifest OK  schema=${manifest.schemaVersion}  version=${manifest.version}`, 'ok');
  log(`buildTime: ${manifest.buildTime}`, 'dim');
  log(`asset count: ${assetKeys.length}`, 'info');

  // 5. Log each asset entry from manifest
  for (const key of assetKeys) {
    const entry = manifest.assets[key];
    log(
      `  • ${key}  size=${entry.size}  type=${entry.contentType}`,
      'dim'
    );
    if (entry.dependencies?.length) {
      log(`    deps: ${entry.dependencies.join(', ')}`, 'dim');
    }
  }

  // 6. loadAll — download every asset
  log('loadAll() — starting concurrent download…', 'info');
  updateProgress(0, 'Downloading assets…');

  let allAssets: Map<string, Blob>;
  try {
    allAssets = await loader.loadAll();
  } catch (err) {
    log(`loadAll failed: ${(err as Error).message}`, 'error');
    updateProgress(0, 'Error – see log');
    return;
  }

  // 7. Log results
  log(`loadAll() complete — ${allAssets.size} assets loaded`, 'ok');
  for (const [key, blob] of allAssets.entries()) {
    log(`  ✓ ${key}  ${blob.size} bytes  type=${blob.type || 'unknown'}`, 'ok');
  }

  // 8. Test single load
  if (assetKeys.length > 0) {
    const firstKey = assetKeys[0];
    log(`load('${firstKey}') — single asset test…`, 'info');
    try {
      const result = await loader.load(firstKey);
      const size =
        result instanceof Blob
          ? result.size
          : result.byteLength;
      log(`  ✓ loaded "${firstKey}"  ${size} bytes`, 'ok');
    } catch (err) {
      log(`load('${firstKey}') failed: ${(err as Error).message}`, 'error');
    }
  }

  // 9. Test load of non-existent key
  log("load('non-existent-key') — expected error test…", 'info');
  try {
    await loader.load('non-existent-key');
    log('  ✗ should have thrown but did not', 'error');
  } catch (err) {
    log(
      `  ✓ correctly threw error: ${(err as { type?: string }).type ?? 'unknown'
      }`,
      'ok'
    );
  }

  // 10. Done
  updateProgress(100, `Done — ${allAssets.size} assets`);
  log('─'.repeat(60), 'dim');
  log('All tests complete ✓', 'ok');
}

main().catch((err) => {
  log(`Unhandled error: ${err instanceof Error ? err.message : String(err)}`, 'error');
});
