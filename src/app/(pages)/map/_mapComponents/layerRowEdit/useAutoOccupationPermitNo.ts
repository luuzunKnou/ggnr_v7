"use client";

import { useEffect, useRef } from "react";
import {
  currentPermitYear,
  isOccupationPermitNoFormat,
  yearFromStartDateYmd,
} from "@/lib/occupationPermitNo";

type Options = {
  /** 편집·신규 중일 때만 */
  enabled: boolean;
  /** 건·편집 세션 식별 (전환 시 수동 잠금 해제) */
  sessionKey: string;
  startDateRaw: string;
  permitValue: string;
  permitFieldKey: string;
  onSetPermit: (fieldKey: string, value: string) => void;
  fetchNext: (year: number) => Promise<string | null>;
  /**
   * true(신규)일 때만 채번. 수정은 저장된 허가번호를 유지한다.
   */
  useCurrentYearWhenEmpty?: boolean;
};

/**
 * 시작일 연도 기준 허가번호(YYYY-NN) 자동채번.
 * 신규 등록에만 쓴다. 수정에서는 저장된 번호를 건드리지 않는다.
 * - 추가 직후 현재 연도 일련(예: 2026-01) 즉시 채움
 * - 시작일 연도가 바뀌면 그 연도 일련으로 갱신
 * - 사용자가 자동형식이 아닌 값을 넣으면 잠금
 */
export function useAutoOccupationPermitNo({
  enabled,
  sessionKey,
  startDateRaw,
  permitValue,
  permitFieldKey,
  onSetPermit,
  fetchNext,
  useCurrentYearWhenEmpty = false,
}: Options) {
  const lastAutoRef = useRef("");
  const manualRef = useRef(false);
  const onSetPermitRef = useRef(onSetPermit);
  const fetchNextRef = useRef(fetchNext);

  onSetPermitRef.current = onSetPermit;
  fetchNextRef.current = fetchNext;

  useEffect(() => {
    manualRef.current = false;
    lastAutoRef.current = "";
  }, [sessionKey]);

  useEffect(() => {
    if (!enabled) return;
    const current = String(permitValue ?? "").trim();
    if (!current) return;
    if (current === lastAutoRef.current) return;
    if (!isOccupationPermitNoFormat(current)) {
      manualRef.current = true;
    }
  }, [enabled, permitValue]);

  useEffect(() => {
    if (!enabled || !permitFieldKey) return;
    if (!useCurrentYearWhenEmpty) return;
    if (manualRef.current) return;

    const fromStart = yearFromStartDateYmd(startDateRaw);
    const year = fromStart ?? currentPermitYear();

    const current = String(permitValue ?? "").trim();

    if (current && isOccupationPermitNoFormat(current)) {
      const codeYear = Number(current.slice(0, 4));
      if (codeYear === year) {
        lastAutoRef.current = current;
        return;
      }
    } else if (current && current !== lastAutoRef.current) {
      manualRef.current = true;
      return;
    }

    let cancelled = false;
    void fetchNextRef.current(year).then((next) => {
      if (cancelled || !next) return;
      if (manualRef.current) return;
      lastAutoRef.current = next;
      if (current !== next) {
        onSetPermitRef.current(permitFieldKey, next);
      }
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 시작일·세션 중심; permitValue는 유지 판별용
  }, [
    enabled,
    sessionKey,
    startDateRaw,
    permitFieldKey,
    permitValue,
    useCurrentYearWhenEmpty,
  ]);
}
