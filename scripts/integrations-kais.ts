import { loadProjectEnv } from './load-project-env';
import { closePool } from '@/database/db';
import { defaultDailyWindow, resolveKaisSggCode, runKais } from '@/integrations/kais';
import { reloadProjectRuntimeEnv } from '@/lib/projectEnvReload';

const HARDCODED_KAIS_APP_KEY = 'U01TX0FVVEgyMDIzMDUzMDE3MzU1NDExMzgxMTM=';

type Args = {
  project?: string;
  env?: string;
  mode: 'initial' | 'daily';
  from?: string;
  to?: string;
  cntc?: string;
};

function parseArgs(argv: string[]): Args {
  const out: Args = { mode: 'daily' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--project' && next) out.project = next;
    if (a === '--env' && next) out.env = next;
    if (a === '--mode' && next && (next === 'initial' || next === 'daily')) out.mode = next;
    if (a === '--from' && next) out.from = next;
    if (a === '--to' && next) out.to = next;
    if (a === '--cntc' && next) out.cntc = next;
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.project && args.env) {
    loadProjectEnv(args.project, args.env);
    reloadProjectRuntimeEnv(args.project, args.env);
  }

  const appKey = (process.env.KAIS_APP_KEY ?? '').trim() || HARDCODED_KAIS_APP_KEY;

  const sggCode = await resolveKaisSggCode();
  const { from, to } = args.from && args.to ? { from: args.from, to: args.to } : defaultDailyWindow();

  const cntcList = (args.cntc ? [args.cntc] : ['300001', '300002', '300003']) as string[];
  for (const cntcCd of cntcList) {
    await runKais({
      mode: args.mode,
      appKey,
      cntcCd,
      dateGb: 'D',
      retryIn: 'Y',
      from,
      to,
      sggCode,
    });
  }
}

main()
  .then(() => closePool())
  .catch(async (e) => {
    console.error(e);
    await closePool().catch(() => {});
    process.exit(1);
  });

