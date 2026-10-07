import { getConsLedgerVariant, type ConsLedgerKind } from "@/lib/consLedgerVariant";

/** 공사대장 종류별 WMS 레이어 (본표·필지) — 하천: cons_data_as / cons_data_solo_as */
export function consLedgerWmsLayerIds(kind: ConsLedgerKind | undefined): {
  main: string;
  solo: string;
} {
  const v = getConsLedgerVariant(kind);
  return { main: v.mainTable, solo: v.soloTable };
}
