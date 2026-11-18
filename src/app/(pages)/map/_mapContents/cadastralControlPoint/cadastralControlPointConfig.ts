/** serviceList.ser_eng / systemList 메뉴 키와 동일 */
export const CADASTRAL_CONTROL_POINT_OPENED_KEY = 'cadastralControlPoint'

export const CADASTRAL_CONTROL_POINT_PANEL_DEFAULT_WIDTH = 420
export const CADASTRAL_CONTROL_POINT_PANEL_MIN_WIDTH = 360
export const CADASTRAL_CONTROL_POINT_PANEL_MAX_WIDTH = 560
export const CADASTRAL_CONTROL_POINT_DETAIL_DEFAULT_WIDTH = 360
export const CADASTRAL_CONTROL_POINT_DETAIL_MIN_WIDTH = 300
export const CADASTRAL_CONTROL_POINT_DETAIL_MAX_WIDTH = 480

export type CadastralControlPointType =
  | 'triangulation'
  | 'triangulationAux'
  | 'traverse'

export type CadastralControlPointTypeDef = {
  code: CadastralControlPointType
  label: string
  color: string
}

export const CADASTRAL_CONTROL_POINT_TYPES: CadastralControlPointTypeDef[] = [
  { code: 'triangulation', label: '삼각점', color: '#dc2626' },
  { code: 'triangulationAux', label: '삼각보조점', color: '#7c3aed' },
  { code: 'traverse', label: '도근점', color: '#2563eb' },
]

export function getCadastralControlPointType(
  code: CadastralControlPointType
): CadastralControlPointTypeDef {
  return (
    CADASTRAL_CONTROL_POINT_TYPES.find((t) => t.code === code) ??
    CADASTRAL_CONTROL_POINT_TYPES[0]!
  )
}
