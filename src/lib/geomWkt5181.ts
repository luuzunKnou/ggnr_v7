import { sql } from 'drizzle-orm';
import { db } from '@/database/db';
import { fetchCoordFromAddress } from '@/lib/vworldAddressServer';

export async function wkt5181FromLonLat4326(lon: number, lat: number): Promise<string | null> {
  try {
    const res = await db.execute(
      sql.raw(
        `SELECT ST_AsText(ST_Transform(ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326), 5181)) AS wkt`
      )
    );
    const wkt = String((res.rows?.[0] as { wkt?: string } | undefined)?.wkt ?? '').trim();
    return wkt || null;
  } catch {
    return null;
  }
}

export async function resolveGeomWkt5181FromAddress(
  addr: string
): Promise<{ wkt: string | null; lon: number | null; lat: number | null }> {
  const trimmed = String(addr ?? '').trim();
  if (!trimmed) return { wkt: null, lon: null, lat: null };
  const lonLat = await fetchCoordFromAddress(trimmed);
  if (!lonLat) return { wkt: null, lon: null, lat: null };
  const wkt = await wkt5181FromLonLat4326(lonLat.lon, lonLat.lat);
  return { wkt, lon: lonLat.lon, lat: lonLat.lat };
}
