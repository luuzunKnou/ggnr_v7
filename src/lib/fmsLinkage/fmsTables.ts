import {
  publicFmsFacility,
  roadFmsFacility,
  waterFmsFacility,
  type FmsFacilityTable,
} from '@/database/schema/fms_facility';
import {
  publicFmsInspection,
  roadFmsInspection,
  waterFmsInspection,
  type FmsInspectionTable,
} from '@/database/schema/fms_inspection';
import type { FmsPrefix } from '@/lib/fmsLinkage/fmsBinding';

export function getFmsFacilityTableByPrefix(prefix: FmsPrefix): FmsFacilityTable {
  if (prefix === 'road') return roadFmsFacility;
  if (prefix === 'public') return publicFmsFacility;
  return waterFmsFacility;
}

export function getFmsInspectionTableByPrefix(prefix: FmsPrefix): FmsInspectionTable {
  if (prefix === 'road') return roadFmsInspection;
  if (prefix === 'public') return publicFmsInspection;
  return waterFmsInspection;
}
