"use client";

import { useEffect, useState } from "react";
import { call } from "@/lib/api";
import type { RiverBasicPlanTab } from "@/lib/riverBasicPlanMapAttachmentLayers";
import type { RiverBasicPlanReportFolderSummary } from "./riverBasicPlanReportPlans";

/** 보고서 폴더는 네트워크 공유 폴더라 읽기가 느려, 목록·하천 목록이 함께 쓰도록 탭별로 잠시 보관 */
const CACHE_MS = 5 * 60_000;
const cache = new Map<RiverBasicPlanTab, { at: number; promise: Promise<RiverBasicPlanReportFolderSummary> }>();

function loadFolders(tab: RiverBasicPlanTab): Promise<RiverBasicPlanReportFolderSummary> {
  const hit = cache.get(tab);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = call("", "POST", {
    service: "riverBasicPlanService",
    action: "getRiverBasicPlanReportFolderSummary",
    params: { tab },
  })
    .then((res) => {
      const data = res?.data ?? res;
      return data?.folders && typeof data.folders === "object"
        ? (data.folders as RiverBasicPlanReportFolderSummary)
        : {};
    })
    .catch(() => {
      cache.delete(tab);
      return {} as RiverBasicPlanReportFolderSummary;
    });
  cache.set(tab, { at: Date.now(), promise });
  return promise;
}

/** 탭의 보고서 폴더 구성(바로 아래 PDF·하천별 폴더 PDF). null 이면 확인 중 */
export function useRiverBasicPlanReportFolders(
  tab: RiverBasicPlanTab,
  enabled = true
): RiverBasicPlanReportFolderSummary | null {
  const [state, setState] = useState<{ tab: RiverBasicPlanTab; folders: RiverBasicPlanReportFolderSummary } | null>(
    null
  );
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void loadFolders(tab).then((folders) => {
      if (!cancelled) setState({ tab, folders });
    });
    return () => {
      cancelled = true;
    };
  }, [tab, enabled]);
  return state?.tab === tab ? state.folders : null;
}
