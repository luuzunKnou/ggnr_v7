import { formatSafetyLayerAddressDisplay } from '../safetyLayerAddressDisplay';
import type { PublicLayerAddressPrefixes } from '@/lib/publicLayerSgg';

export function formatWaterPlaySignAddressDisplay(
  raw: unknown,
  prefixes: PublicLayerAddressPrefixes = { sidoName: '', sggName: '' }
): string {
  return formatSafetyLayerAddressDisplay(raw, prefixes);
}
