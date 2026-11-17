import fs from 'node:fs/promises';

export type PreparedSourceZipMeta = {
  progressId: string;
  zipPath: string;
  zipName: string;
  zipSize: number;
  mode: string;
  date: string;
  changeNote: string;
  bundleRoot: string;
  includeNodeModules: boolean;
  clientIp?: string;
  workspaceRoot: string;
  items: unknown[];
  localStages: unknown[];
  scanSummary: unknown;
  dbCompare: unknown;
  schemaMismatch: boolean;
  createdAt: number;
};

const GLOBAL_KEY = '__ggnr_prepared_source_zip_store__';
const TTL_MS = 2 * 60 * 60 * 1000;

function store(): Map<string, PreparedSourceZipMeta> {
  const g = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: Map<string, PreparedSourceZipMeta>;
  };
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map();
  return g[GLOBAL_KEY];
}

function prune(): void {
  const now = Date.now();
  for (const [id, meta] of store()) {
    if (now - meta.createdAt > TTL_MS) {
      store().delete(id);
      void fs.rm(meta.zipPath, { force: true }).catch(() => {});
    }
  }
}

export function setPreparedSourceZip(meta: PreparedSourceZipMeta): void {
  prune();
  store().set(meta.progressId, meta);
}

export function getPreparedSourceZip(progressId: string): PreparedSourceZipMeta | null {
  prune();
  return store().get(progressId) ?? null;
}

export async function clearPreparedSourceZip(progressId: string): Promise<void> {
  const meta = store().get(progressId);
  store().delete(progressId);
  if (meta?.zipPath) {
    await fs.rm(meta.zipPath, { force: true }).catch(() => {});
    const dir = meta.zipPath.replace(/[/\\][^/\\]+$/, '');
    if (dir.includes('ggnr_upload_')) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
