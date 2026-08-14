import { getAllUseFeeWmsLayerIds, getUseFeeWmsLayerId } from '@/lib/useFeeBinding'

/** @deprecated system별 getUseFeeWmsLayerId 사용 — 기본은 하천 */
export const USE_FEE_WMS_LAYER_ID = getUseFeeWmsLayerId('river')

export { getUseFeeWmsLayerId, getAllUseFeeWmsLayerIds }
