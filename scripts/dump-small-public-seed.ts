/**
 * file_data/small_public 을 읽어 seed.json + 저장소 smallPublicSeed.json 생성.
 *
 * 사용:
 *   npx tsx scripts/dump-small-public-seed.ts
 *   npx tsx scripts/dump-small-public-seed.ts --root "g:/ggnr_data_dir/ggnr_sy/file_data/small_public"
 */
import path from 'node:path'
import { dumpSeed } from '../src/service/smallPublicService'

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  if (i < 0) return undefined
  return process.argv[i + 1]
}

async function main() {
  const rootArg = argValue('--root')
  const dataRoot =
    rootArg?.trim() ||
    path.join('g:', 'ggnr_data_dir', 'ggnr_sy', 'file_data', 'small_public')
  const shpDir = argValue('--shp') || path.join(dataRoot, 'shp')
  console.log('[dump-small-public-seed] root=', dataRoot)
  console.log('[dump-small-public-seed] shp=', shpDir)
  const result = await dumpSeed({ dataRoot, shpDir })
  console.log(
    `[dump-small-public-seed] ok matched=${result.matched} bytes=${result.bytes} ms=${result.ms}`
  )
  console.log('[dump-small-public-seed] data=', result.dataPath)
  console.log('[dump-small-public-seed] repo=', result.repoPath)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
