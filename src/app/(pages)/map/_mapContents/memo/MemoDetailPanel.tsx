"use client";

import { useEffect, useState } from "react";
import { Calendar, Check, Crosshair, FileText, Loader2, MapPin, Type, User, X } from "lucide-react";
import { useSession } from "next-auth/react";
import { call } from "@/lib/api";
import { recordDataViewLog } from "@/lib/recordDataViewLog";
import { formatToYmdOrText } from "@/lib/formatDateYmd";
import { Input } from "@/app/shadcnComponents/ui/input";
import { Button } from "@/app/shadcnComponents/ui/button";
import { useMapContext } from "../../_mapComponents/MapContext";
import { AddressSearchPanel } from "../../_mapComponents/addressSearch/AddressSearchPanel";
import { useMapPointPick } from "../../_mapComponents/addressSearch/useMapPointPick";
import { LAYER_ROW_NEW_ID } from "../../_mapComponents/layerRowEdit";
import { encodeMemoRowKey, memoWmsLayerId, parseMemoRowKey } from "./memoConfig";
import { MEMO_KEY_FIELD } from "@/lib/memoConfig";
import { MapSideDetailScroll } from "../../_mapComponents/MapSideDetailScroll";
import { MapFloatingPanel } from "../../_mapComponents/MapFloatingPanel";
import { cn } from "@/lib/utils";

type Props = {
  mode?: "add" | "edit";
  detailId?: string;
  addTableName?: string;
  onClose: () => void;
  onSaved?: () => void;
  onCreated?: (newRowKey: string) => void;
  onDeleted?: () => void;
};

export function MemoDetailPanel({
  mode = "edit",
  detailId = "",
  addTableName = "",
  onClose,
  onSaved,
  onCreated,
  onDeleted,
}: Props) {
  const mapContext = useMapContext();
  const { data: session } = useSession();
  const isCreateMode = mode === "add";
  const parsed = isCreateMode ? null : parseMemoRowKey(detailId);
  const tableName = isCreateMode ? addTableName : (parsed?.tableName ?? "");
  const memoKey = isCreateMode ? LAYER_ROW_NEW_ID : (parsed?.memoKey ?? "");

  const [loading, setLoading] = useState(!isCreateMode);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [contents, setContents] = useState("");
  const [createDate, setCreateDate] = useState("");
  const [createUser, setCreateUser] = useState("");
  const [createGroup, setCreateGroup] = useState("");
  const [address, setAddress] = useState("");
  const [lon, setLon] = useState<number | null>(null);
  const [lat, setLat] = useState<number | null>(null);
  const [hasGeom, setHasGeom] = useState(false);

  const setVisibleLayerNames = mapContext?.setVisibleLayerNames;
  const vworldApiKey = mapContext?.vworldApiKey ?? "";
  /** 화면 기준 기본 위치 — 목록 패널 오른쪽(지도 왼쪽 끝)에서 조금 떨어뜨림 */
  const floatingLeftPx = (mapContext?.mapPaddingLeft ?? 0) + 20;

  const { pickMode, startPick, stopPick, clearDraftPoint } = useMapPointPick({
    vworldApiKey,
    onPicked: ({ lon: pickedLon, lat: pickedLat, address: pickedAddress }) => {
      if (pickedAddress) setAddress(pickedAddress);
      setLon(pickedLon);
      setLat(pickedLat);
      setHasGeom(true);
    },
  });

  useEffect(() => {
    if (isCreateMode) {
      setTitle("");
      setContents("");
      setCreateDate(formatToYmdOrText(new Date()));
      setCreateUser(String(session?.user?.name ?? "").trim() || String(session?.user?.id ?? "").trim());
      setCreateGroup("");
      setAddress("");
      setLon(null);
      setLat(null);
      setHasGeom(false);
      setLoading(false);
      setError(null);
      void call("", "POST", {
        service: "usrService",
        action: "getMyProfile",
        params: {},
      }).then((res) => {
        const profile = res?.data?.data ?? res?.data ?? res;
        const name = String(profile?.name ?? session?.user?.name ?? "").trim();
        const dept = String(profile?.dept ?? "").trim();
        if (name) setCreateUser(name);
        if (dept) setCreateGroup(dept);
      });
      return;
    }
    if (!tableName || !memoKey) {
      setError("잘못된 메모 ID입니다.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setAddress("");
    setLon(null);
    setLat(null);
    void call("", "POST", {
      service: "memoService",
      action: "getMemoDetail",
      params: { table: tableName, memoKey },
    })
      .then((res) => {
        const data = res?.data ?? res;
        if (data?.error) {
          setError(String(data.error));
          return;
        }
        setTitle(String(data.title ?? ""));
        setContents(String(data.contents ?? ""));
        setCreateDate(String(data.createDate ?? ""));
        setCreateUser(String(data.createUser ?? ""));
        setCreateGroup(String(data.createGroup ?? ""));
        setAddress(String(data.address ?? ""));
        setHasGeom(Boolean(data.hasGeom));
        const loadedLon = Number(data.lon);
        const loadedLat = Number(data.lat);
        setLon(Number.isFinite(loadedLon) ? loadedLon : null);
        setLat(Number.isFinite(loadedLat) ? loadedLat : null);
      })
      .catch(() => setError("상세 정보를 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, [isCreateMode, memoKey, tableName, session?.user?.id, session?.user?.name]);

  useEffect(() => {
    if (isCreateMode || !tableName || !memoKey) return;
    recordDataViewLog({
      tableName,
      keyField: MEMO_KEY_FIELD,
      keyValue: memoKey,
      serviceName: "메모",
    });
  }, [isCreateMode, tableName, memoKey]);

  useEffect(() => {
    if (!tableName) return;
    const lid = memoWmsLayerId(tableName);
    setVisibleLayerNames?.((prev) => {
      if (prev.has(lid)) return prev;
      return new Set(prev).add(lid);
    });
  }, [setVisibleLayerNames, tableName]);

  const handleSave = async () => {
    if (!tableName) return;
    setSaving(true);
    setError(null);
    try {
      const saveParams = {
        table: tableName,
        title,
        contents,
        address,
        lon,
        lat,
      };
      if (isCreateMode) {
        const res = await call("", "POST", {
          service: "memoService",
          action: "createMemo",
          params: {
            ...saveParams,
            createUser,
            createGroup,
          },
        });
        const data = res?.data ?? res;
        if (data?.error || data?.success === false) {
          setError(String(data?.error ?? "등록에 실패했습니다."));
          return;
        }
        const newKey = String(data?.memoKey ?? "").trim();
        if (!newKey) {
          setError("등록 후 키를 확인하지 못했습니다.");
          return;
        }
        onCreated?.(encodeMemoRowKey(tableName, newKey));
        clearDraftPoint();
        onSaved?.();
        return;
      }

      const res = await call("", "POST", {
        service: "memoService",
        action: "updateMemo",
        params: {
          ...saveParams,
          memoKey,
        },
      });
      const data = res?.data ?? res;
      if (data?.error || data?.success === false) {
        setError(String(data?.error ?? "저장에 실패했습니다."));
        return;
      }
      setHasGeom(lon != null && lat != null);
      clearDraftPoint();
      onSaved?.();
    } catch {
      setError("저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!tableName || !memoKey || isCreateMode) return;
    if (!window.confirm("이 메모를 삭제할까요?")) return;
    setDeleting(true);
    try {
      const res = await call("", "POST", {
        service: "memoService",
        action: "deleteMemo",
        params: { table: tableName, memoKey },
      });
      const data = res?.data ?? res;
      if (data?.error || data?.success === false) {
        window.alert(String(data?.error ?? "삭제에 실패했습니다."));
        return;
      }
      onDeleted?.();
    } catch {
      window.alert("삭제에 실패했습니다.");
    } finally {
      setDeleting(false);
    }
  };

  if (!isCreateMode && (!tableName || !memoKey || memoKey === LAYER_ROW_NEW_ID)) return null;

  const form = (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <MapSideDetailScroll className="min-h-0 flex-1 overflow-auto p-4 text-xs">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            로딩 중...
          </div>
        )}
        {!loading && error && (
          <div className="mb-3 rounded border border-red-100 bg-red-50 px-2 py-2 text-red-700">{error}</div>
        )}
        {!loading && (
          <div className="rounded-xl border border-border bg-card px-3 pt-3 pb-[15px]">
            <div className="flex flex-col gap-3.5">
              <div className="flex items-center gap-2">
                <span className="flex h-8 shrink-0 items-center text-muted-foreground/80">
                  <Type className="h-3.5 w-3.5" />
                </span>
                <span className="w-14 shrink-0 text-[12px] text-muted-foreground/90">제목</span>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="-"
                  style={{ fontSize: "12px" }}
                  className="h-8 flex-1 min-w-0 border-border bg-background placeholder:text-[12px]"
                />
              </div>
              <div className="grid grid-cols-1 gap-y-3.5 sm:grid-cols-2 sm:gap-x-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 shrink-0 items-center text-muted-foreground/70">
                    <Calendar className="h-3.5 w-3.5" />
                  </span>
                  <span className="w-14 shrink-0 text-[12px] text-muted-foreground/80">작성일</span>
                  <div className="flex h-8 flex-1 min-w-0 items-center rounded-md bg-muted/50 px-3 text-[12px] text-muted-foreground">
                    {createDate || "-"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex h-8 shrink-0 items-center text-muted-foreground/70">
                    <User className="h-3.5 w-3.5" />
                  </span>
                  <span className="w-14 shrink-0 text-[12px] text-muted-foreground/80">작성자</span>
                  <div className="flex h-8 flex-1 min-w-0 items-center rounded-md bg-muted/50 px-3 text-[12px] text-muted-foreground">
                    {createUser || "-"}
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="flex h-5 shrink-0 items-center text-muted-foreground/80">
                  <FileText className="h-3.5 w-3.5" />
                </span>
                <span className="flex h-5 w-14 shrink-0 items-center text-[12px] text-muted-foreground/90">내용</span>
                <textarea
                  value={contents}
                  onChange={(e) => setContents(e.target.value)}
                  placeholder="-"
                  rows={6}
                  style={{ fontSize: "12px" }}
                  className="min-h-[5.5rem] flex-1 min-w-0 resize-none rounded-md border border-border bg-background px-3 py-2 text-foreground/90 placeholder:text-muted-foreground focus:outline-none focus:ring-0 focus:border-primary"
                />
              </div>
              <div className="flex items-start gap-2">
                <span className="flex h-8 shrink-0 items-center text-muted-foreground/80">
                  <MapPin className="h-3.5 w-3.5" />
                </span>
                <span className="flex h-8 w-14 shrink-0 items-center text-[12px] text-muted-foreground/90">주소</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <AddressSearchPanel
                        layout="field"
                        includePlace
                        vworldApiKey={vworldApiKey}
                        initialQuery={address}
                        placeholder="주소/지번/장소 검색"
                        onSelect={(item) => {
                          const adr =
                            (item.roadAddress ?? "").trim() ||
                            (item.jibunAddress ?? "").trim() ||
                            (item.title ?? "").trim() ||
                            (item.address ?? "").trim();
                          const itemLon = Number(item.point?.x);
                          const itemLat = Number(item.point?.y);
                          setAddress(adr);
                          setLon(Number.isFinite(itemLon) ? itemLon : null);
                          setLat(Number.isFinite(itemLat) ? itemLat : null);
                          setHasGeom(Number.isFinite(itemLon) && Number.isFinite(itemLat));
                        }}
                        onClear={() => {
                          setAddress("");
                          setLon(null);
                          setLat(null);
                          setHasGeom(false);
                        }}
                      />
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      title={pickMode ? "위치 지정 취소" : "지도에서 위치 찍기"}
                      aria-label={pickMode ? "위치 지정 취소" : "지도에서 위치 찍기"}
                      onClick={pickMode ? stopPick : startPick}
                      className={cn(
                        "h-8 w-8 shrink-0 p-0",
                        pickMode
                          ? "border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-50"
                          : "border-border bg-background text-muted-foreground hover:border-primary hover:bg-primary/15 hover:text-primary"
                      )}
                    >
                      {pickMode ? <X className="h-3.5 w-3.5" /> : <Crosshair className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                  {pickMode && (
                    <p className="mt-1 text-[11px] text-muted-foreground">지도를 클릭해 메모 위치를 지정하세요.</p>
                  )}
                  {!address && hasGeom && !pickMode && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      저장된 위치가 있으나 주소가 없습니다. 주소를 검색하거나 지도에서 위치를 지정하세요.
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              {!isCreateMode && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                  className="h-[26px] min-h-[26px] cursor-pointer gap-1 px-2.5 text-[12px] font-light border border-border bg-muted/50 text-muted-foreground hover:border-destructive hover:bg-destructive/15 hover:text-destructive disabled:cursor-not-allowed"
                >
                  <X className="h-3 w-3" />
                  {deleting ? "삭제 중…" : "삭제"}
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => void handleSave()}
                disabled={saving}
                className="h-[26px] min-h-[26px] cursor-pointer gap-1 px-2.5 text-[12px] font-light border border-border bg-muted/50 text-muted-foreground hover:border-primary hover:bg-primary/15 hover:text-primary disabled:cursor-not-allowed"
              >
                <Check className="h-3 w-3" />
                {saving ? "저장 중…" : "저장"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onClose}
                className="h-[26px] min-h-[26px] cursor-pointer gap-1 px-2.5 text-[12px] font-light border border-border bg-muted/50 text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground"
              >
                <X className="h-3 w-3" />
                닫기
              </Button>
            </div>
          </div>
        )}
      </MapSideDetailScroll>
    </div>
  );

  return (
    <MapFloatingPanel
      viewport
      width="600px"
      maxHeight="85vh"
      defaultPosition={{ top: 80, left: floatingLeftPx }}
      header={
        <>
          <span className="text-xs font-medium text-muted-foreground">
            {isCreateMode ? "메모 추가" : `메모 #${memoKey}`}
          </span>
          <button
            type="button"
            title="닫기"
            onClick={onClose}
            className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            aria-label="닫기"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      }
    >
      {form}
    </MapFloatingPanel>
  );
}
