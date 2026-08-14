import {
  publicNglFeeList,
  roadNglFeeList,
  waterNglFeeList,
  type NglFeeListTable,
} from '@/database/schema/ngl_fee_list';
import type { UseFeePrefix } from '@/lib/useFeeBinding';

export function getNglFeeListTableByPrefix(prefix: UseFeePrefix): NglFeeListTable {
  if (prefix === 'road') return roadNglFeeList;
  if (prefix === 'public') return publicNglFeeList;
  return waterNglFeeList;
}
