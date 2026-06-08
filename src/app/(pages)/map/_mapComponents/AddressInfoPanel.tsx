'use client';

import { LandInfoPanelContent } from './landInfo/LandInfoPanelContent';
import {
  COORDINATE_SYSTEM_OPTIONS,
  type AddressInfoPanelProps,
} from './landInfo/shared';

export function AddressInfoPanel(props: AddressInfoPanelProps) {
  return <LandInfoPanelContent {...props} />;
}

export { COORDINATE_SYSTEM_OPTIONS };
export type { AddressInfoPanelProps };
