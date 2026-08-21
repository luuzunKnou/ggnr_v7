"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Draw } from "ol/interaction";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { Point } from "ol/geom";
import { Style, Circle as CircleStyle, Fill, Stroke } from "ol/style";
import { Loader2, MapPin } from "lucide-react";
import { call } from "@/lib/api";
import { recordDataViewLog } from "@/lib/recordDataViewLog";
import { formatToYmdOrText } from "@/lib/formatDateYmd";
import { useMapContext } from "../../_mapComponents/MapContext";
import { LAYER_ROW_NEW_ID } from "../../_mapComponents/layerRowEdit";
import { encodeMemoRowKey, memoWmsLayerId, parseMemoRowKey } from "./memoConfig";
import { MEMO_KEY_FIELD } from "@/lib/memoConfig";
import { MapSideDetailScroll } from "../../_mapComponents/MapSideDetailScroll";

type Props = {
  detailId: string;
  onClose: () => void;
  onSaved?: () => void;
  onCreated?: (newRowKey: string) => void;
  onDeleted?: () => void;
};

const DRAFT_LAYER_ID = "memo-draft-point";

export function MemoDetailPanel({ detailId, onClose, onSaved, onCreated, onDeleted }: Props) {
  const mapContext = useMapContext();
  const parsed = parseMemoRowKey(detailId);
  const tableName = parsed?.tableName ?? "";
  const memoKey = parsed?.memoKey ?? "";
  const isCreateMode = memoKey === LAYER_ROW_NEW_ID;

  const [loading, setLoading] = useState(!isCreateMode);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(isCreateMode);
  const [title, setTitle] = useState("");
  const [contents, setContents] = useState("");
  const [createDate, setCreateDate] = useState("");
  const [hasGeom, setHasGeom] = useState(false);
  const [pointSet, setPointSet] = useState(false);
  const [pickMode, setPickMode] = useState(false);
  const point3857Ref = useRef<{ x: number; y: number } | null>(null);
  const drawLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const drawRef = useRef<Draw | null>(null);

  const stopPick = useCallback(() => {
    setPickMode(false);
    const map = mapContext?.mapInstanceRef?.current;
    if (map && drawRef.current) {
      map.removeInteraction(drawRef.current);
      drawRef.current = null;
    }
  }, [mapContext?.mapInstanceRef]);

  const startPick = useCallback(() => {
    const map = mapContext?.mapInstanceRef?.current;
    if (!map) {
      window.alert("지도가 준비되지 않았습니다.");
      return;
    }
    stopPick();
    setPickMode(true);
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
        point3857Ref.current = { x, y };
        setPointSet(true);
        source.clear();
        source.addFeature(new Feature(new Point([x, y])));
      }
      stopPick();
    });
    map.addInteraction(draw);
    drawRef.current = draw;
  }, [mapContext?.mapInstanceRef, stopPick]);

  useEffect(() => {
    return () => {
      stopPick();
      const map = mapContext?.mapInstanceRef?.current;
      if (map && drawLayerRef.current) {
        map.removeLayer(drawLayerRef.current);
        drawLayerRef.current = null;
      }
    };
  }, [mapContext?.mapInstanceRef, stopPick]);

  useEffect(() => {
    if (isCreateMode) {
      setTitle("");
      setContents("");
      setCreateDate(formatToYmdOrText(new Date()));
      setHasGeom(false);
      setPointSet(false);
      setLoading(false);
      setIsEditing(true);
      setError(null);
      point3857Ref.current = null;
      return;
    }
    if (!tableName || !memoKey) {
      setError("잘못된 메모 ID입니다.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
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
        setHasGeom(Boolean(data.hasGeom));
        setPointSet(false);
        setIsEditing(false);
        point3857Ref.current = null;
      })
      .catch(() => setError("상세 정보를 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, [isCreateMode, memoKey, tableName]);

  // 데이터 이력관리에 조회 저장을 위해 추가
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
    mapContext?.setVisibleLayerNames?.((prev) => {
      if (prev.has(lid)) return prev;
      return new Set(prev).add(lid);
    });
  }, [mapContext?.setVisibleLayerNames, tableName]);

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
        setIsEditing(false);
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
      setHasGeom(Boolean(point) || hasGeom);
      setPointSet(Boolean(point));
      setIsEditing(false);
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <p className="text-sm font-semibold text-foreground">{isCreateMode ? "메모 등록" : "메모 상세"}</p>
        <div className="flex items-center gap-1">
          {!isCreateMode && !isEditing && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="rounded px-2 py-1 text-[10px] text-[#1D6AE3] hover:bg-blue-50"
            >
              수정
            </button>
          )}
          {isEditing && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="rounded bg-[#1D6AE3] px-2 py-1 text-[10px] text-white hover:bg-[#1558b8] disabled:opacity-50"
            >
              {saving ? "저장 중…" : "저장"}
            </button>
          )}
          {isEditing && !isCreateMode && (
            <button
              type="button"
              onClick={() => {
                stopPick();
                setIsEditing(false);
                setError(null);
              }}
              className="rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted/50"
            >
              취소
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted/50"
          >
            닫기
          </button>
        </div>
      </div>

      <MapSideDetailScroll className="min-h-0 flex-1 overflow-auto px-3 py-2 text-xs">
        {loading && (
          <div className="flex items-center gap-2 py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            불러오는 중…
          </div>
        )}
        {!loading && error && (
          <div className="mb-2 rounded border border-red-100 bg-red-50 px-2 py-2 text-red-700">{error}</div>
        )}
        {!loading && (
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-[10px] font-medium text-muted-foreground">제목</span>
              <input
                type="text"
                value={title}
                readOnly={!isEditing}
                onChange={(e) => setTitle(e.target.value)}
                className="h-8 w-full rounded border border-border px-2 disabled:bg-muted/30"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-medium text-muted-foreground">작성일</span>
              <input
                type="text"
                value={createDate || "-"}
                readOnly
                className="h-8 w-full rounded border border-border bg-muted/30 px-2 text-muted-foreground"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-medium text-muted-foreground">내용</span>
              <textarea
                value={contents}
                readOnly={!isEditing}
                onChange={(e) => setContents(e.target.value)}
                rows={6}
                className="w-full resize-y rounded border border-border px-2 py-1.5 disabled:bg-muted/30"
              />
            </label>
            <div className="rounded border border-border bg-muted/30 px-2 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" aria-hidden />
                  {hasGeom || pointSet ? "위치 지정됨" : "위치 없음"}
                </span>
                {isEditing && (
                  <button
                    type="button"
                    onClick={pickMode ? stopPick : startPick}
                    className={cnPickBtn(pickMode)}
                  >
                    {pickMode ? "위치 지정 취소" : "지도에서 위치 찍기"}
                  </button>
                )}
              </div>
              {isEditing && (
                <p className="mt-1 text-[10px] text-muted-foreground">지도를 클릭해 메모 위치(POINT)를 지정하세요.</p>
              )}
            </div>
            {!isCreateMode && !isEditing && (
              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleDelete()}
                className="w-full rounded border border-red-200 py-2 text-[10px] text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {deleting ? "삭제 중…" : "삭제"}
              </button>
            )}
          </div>
        )}
      </MapSideDetailScroll>
    </div>
  );
}

function cnPickBtn(active: boolean): string {
  return active
    ? "rounded border border-orange-300 bg-orange-50 px-2 py-1 text-[10px] text-orange-700"
    : "rounded border border-[#1D6AE3]/30 bg-background px-2 py-1 text-[10px] text-[#1D6AE3] hover:bg-blue-50";
}
