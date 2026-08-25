"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Draw } from "ol/interaction";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { Point } from "ol/geom";
import { transform } from "ol/proj";
import { Style, Circle as CircleStyle, Fill, Stroke } from "ol/style";
import { Calendar, Check, FileText, Loader2, MapPin, Type, User, X } from "lucide-react";
import { useSession } from "next-auth/react";
import { call } from "@/lib/api";
import { recordDataViewLog } from "@/lib/recordDataViewLog";
import { formatToYmdOrText } from "@/lib/formatDateYmd";
import { Input } from "@/app/shadcnComponents/ui/input";
import { Button } from "@/app/shadcnComponents/ui/button";
import { useMapContext } from "../../_mapComponents/MapContext";
import { getAddressFromCoord } from "../../_mapComponents/addressSearch/vworldAddressSearch";
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

const DRAFT_LAYER_ID = "memo-draft-point";

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
  const [hasGeom, setHasGeom] = useState(false);
  const [pointSet, setPointSet] = useState(false);
  const [pickMode, setPickMode] = useState(false);
  const [locationLabel, setLocationLabel] = useState("");
  const point3857Ref = useRef<{ x: number; y: number } | null>(null);
  const drawLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const drawRef = useRef<Draw | null>(null);

  const mapInstanceRef = mapContext?.mapInstanceRef;
  const setDrawSuspended = mapContext?.setMapDrawInputSuspended;
  const setVisibleLayerNames = mapContext?.setVisibleLayerNames;
  const vworldApiKey = mapContext?.vworldApiKey ?? "";

  const fillAddressFromLonLat = useCallback(
    async (lon: number, lat: number) => {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
        setLocationLabel("");
        return;
      }
      setLocationLabel("주소 조회 중…");
      const addr = await getAddressFromCoord(lon, lat, { apiKey: vworldApiKey || undefined });
      const text = (addr?.road || addr?.jibun || "").trim();
      setLocationLabel(text || "주소 없음");
    },
    [vworldApiKey]
  );
  const fillAddressFromLonLatRef = useRef(fillAddressFromLonLat);
  fillAddressFromLonLatRef.current = fillAddressFromLonLat;

  const stopPick = useCallback(() => {
    setPickMode(false);
    const map = mapInstanceRef?.current;
    if (map && drawRef.current) {
      map.removeInteraction(drawRef.current);
      drawRef.current = null;
    }
    setDrawSuspended?.(false);
  }, [mapInstanceRef, setDrawSuspended]);

  const startPick = useCallback(() => {
    const map = mapInstanceRef?.current;
    if (!map) {
      window.alert("지도가 준비되지 않았습니다.");
      return;
    }
    if (drawRef.current) {
      map.removeInteraction(drawRef.current);
      drawRef.current = null;
    }
    setPickMode(true);
    setDrawSuspended?.(true);
    if (!drawLayerRef.current) {
      const source = new VectorSource();
      const layer = new VectorLayer({
        source,
        properties: { id: DRAFT_LAYER_ID },
        zIndex: 9999,
        style: new Style({
          image: new CircleStyle({
            radius: 8,
            fill: new Fill({ color: "rgba(29, 106, 227, 0.85)" }),
            stroke: new Stroke({ color: "#fff", width: 2 }),
          }),
        }),
      });
      map.addLayer(layer);
      drawLayerRef.current = layer;
    }
    const source = drawLayerRef.current.getSource();
    if (!source) return;
    const draw = new Draw({ source, type: "Point", stopClick: true });
    draw.on("drawend", (e) => {
      const geom = e.feature.getGeometry();
      if (geom instanceof Point) {
        const [x, y] = geom.getCoordinates();
        const viewProj = map.getView().getProjection()?.getCode() || "EPSG:3857";
        const [x3857, y3857] =
          viewProj === "EPSG:3857" ? [x, y] : transform([x, y], viewProj, "EPSG:3857");
        point3857Ref.current = { x: x3857, y: y3857 };
        setPointSet(true);
        source.clear();
        source.addFeature(new Feature(new Point([x, y])));
        const [lon, lat] = transform([x3857, y3857], "EPSG:3857", "EPSG:4326");
        void fillAddressFromLonLat(lon, lat);
      }
      setPickMode(false);
      if (drawRef.current) {
        map.removeInteraction(drawRef.current);
        drawRef.current = null;
      }
      setDrawSuspended?.(false);
    });
    map.addInteraction(draw);
    drawRef.current = draw;
  }, [fillAddressFromLonLat, mapInstanceRef, setDrawSuspended]);

  useEffect(() => {
    return () => {
      const map = mapInstanceRef?.current;
      if (map && drawRef.current) {
        map.removeInteraction(drawRef.current);
        drawRef.current = null;
      }
      if (map && drawLayerRef.current) {
        map.removeLayer(drawLayerRef.current);
        drawLayerRef.current = null;
      }
      setDrawSuspended?.(false);
    };
  }, [mapInstanceRef, setDrawSuspended]);

  useEffect(() => {
    if (isCreateMode) {
      setTitle("");
      setContents("");
      setCreateDate(formatToYmdOrText(new Date()));
      setCreateUser(String(session?.user?.name ?? "").trim() || String(session?.user?.id ?? "").trim());
      setCreateGroup("");
      setHasGeom(false);
      setPointSet(false);
      setLocationLabel("");
      point3857Ref.current = null;
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
    setPointSet(false);
    setLocationLabel("");
    point3857Ref.current = null;
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
        setHasGeom(Boolean(data.hasGeom));
        const lon = Number(data.lon);
        const lat = Number(data.lat);
        if (Boolean(data.hasGeom) && Number.isFinite(lon) && Number.isFinite(lat)) {
          void fillAddressFromLonLatRef.current(lon, lat);
        } else {
          setLocationLabel("");
        }
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
      const point = point3857Ref.current;
      if (isCreateMode) {
        const res = await call("", "POST", {
          service: "memoService",
          action: "createMemo",
          params: {
            table: tableName,
            title,
            contents,
            pointX3857: point?.x,
            pointY3857: point?.y,
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
        onSaved?.();
        stopPick();
        return;
      }

      const res = await call("", "POST", {
        service: "memoService",
        action: "updateMemo",
        params: {
          table: tableName,
          memoKey,
          title,
          contents,
          pointX3857: point?.x,
          pointY3857: point?.y,
        },
      });
      const data = res?.data ?? res;
      if (data?.error || data?.success === false) {
        setError(String(data?.error ?? "저장에 실패했습니다."));
        return;
      }
      if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
        setHasGeom(true);
        setPointSet(true);
        const [lon, lat] = transform([point.x, point.y], "EPSG:3857", "EPSG:4326");
        void fillAddressFromLonLat(lon, lat);
      }
      stopPick();
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
                <span className="flex h-8 w-14 shrink-0 items-center text-[12px] text-muted-foreground/90">위치</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 min-w-0 flex-1 items-center rounded-md border border-border bg-background px-3 text-[12px] text-foreground/90">
                      <span className="truncate">
                        {locationLabel || (hasGeom || pointSet ? "주소 없음" : "없음")}
                      </span>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={pickMode ? stopPick : startPick}
                      className={cn(
                        "h-8 shrink-0 px-2.5 text-[12px] font-light",
                        pickMode
                          ? "border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-50"
                          : "border-border bg-background text-muted-foreground hover:border-primary hover:bg-primary/15 hover:text-primary"
                      )}
                    >
                      {pickMode ? "위치 지정 취소" : "지도에서 위치 찍기"}
                    </Button>
                  </div>
                  {pickMode && (
                    <p className="mt-1 text-[11px] text-muted-foreground">지도를 클릭해 메모 위치를 지정하세요.</p>
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
      width="600px"
      maxHeight="85vh"
      defaultPosition={{ top: 80, left: 20 }}
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
