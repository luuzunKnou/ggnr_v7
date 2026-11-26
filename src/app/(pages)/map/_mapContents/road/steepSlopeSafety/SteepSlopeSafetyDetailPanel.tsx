"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileDown,
  Paperclip,
  Pencil,
  Plus,
  Printer,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ServiceFileImagePreview,
  type ServiceFilePreviewItem,
} from "../../../_mapComponents/standard/ServiceFileImagePreview";
import {
  STEEP_SLOPE_ATTACHMENT_MAX,
  STEEP_SLOPE_CHECK_GROUPS,
  STEEP_SLOPE_CHECK_VALUE_LABEL,
  type SteepSlopeCheckValue,
} from "./steepSlopeSafetyConfig";
import {
  createEmptySteepSlopeSafetyCard,
  formatSteepSlopeSpec,
  isNewSteepSlopeSafetyId,
  steepSlopeAttachmentCaption,
  steepSlopeAttachmentLabelFromFileName,
  type SteepSlopeAttachment,
  type SteepSlopeSafetyCard,
} from "./steepSlopeSafetyMock";
import {
  getSteepSlopeSafetyCard,
  removeSteepSlopeSafetyCard,
  upsertSteepSlopeSafetyCard,
  useSteepSlopeSafetyCards,
} from "./steepSlopeSafetyStore";
import {
  downloadSteepSlopeSafetyCardPdf,
  printSteepSlopeSafetyCard,
} from "./steepSlopeSafetyPrint";

const actionBtn =
  "inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50";

const fieldClass =
  "h-7 w-full rounded border border-border bg-background px-1.5 text-xs outline-none focus:ring-1 focus:ring-ring";

type Props = {
  cardId: string;
  onSelectId: (id: string | null) => void;
  onClose: () => void;
};

export function SteepSlopeSafetyDetailPanel({
  cardId,
  onSelectId,
  onClose,
}: Props) {
  const cards = useSteepSlopeSafetyCards();
  const stored = useMemo(
    () => getSteepSlopeSafetyCard(cardId),
    [cardId, cards]
  );
  const isCreate = isNewSteepSlopeSafetyId(cardId);
  const [isEditing, setIsEditing] = useState(isCreate);
  const [draft, setDraft] = useState<SteepSlopeSafetyCard>(
    () => stored ?? createEmptySteepSlopeSafetyCard()
  );
  const [busy, setBusy] = useState(false);
  const [attachOpen, setAttachOpen] = useState(true);
  const [attachPreview, setAttachPreview] = useState<{
    items: ServiceFilePreviewItem[];
    index: number;
  } | null>(null);
  const [photoSlotPickIndex, setPhotoSlotPickIndex] = useState<number | null>(
    null
  );
  const photoSlotInputRef = useRef<HTMLInputElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const next = getSteepSlopeSafetyCard(cardId) ?? createEmptySteepSlopeSafetyCard();
    setDraft(structuredClone(next));
    setIsEditing(isNewSteepSlopeSafetyId(cardId));
  }, [cardId]);

  const display = isEditing ? draft : (stored ?? draft);

  const setField = <K extends keyof SteepSlopeSafetyCard>(
    key: K,
    value: SteepSlopeSafetyCard[K]
  ) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const setCheck = (
    key: string,
    patch: Partial<{ value: SteepSlopeCheckValue; note: string }>
  ) => {
    setDraft((prev) => ({
      ...prev,
      checks: {
        ...prev.checks,
        [key]: { ...prev.checks[key], value: "", note: "", ...patch },
      },
    }));
  };

  const beginEdit = () => {
    setDraft(structuredClone(stored ?? createEmptySteepSlopeSafetyCard()));
    setIsEditing(true);
  };

  const cancelEdit = () => {
    if (isCreate) {
      onSelectId(null);
      return;
    }
    setDraft(structuredClone(stored!));
    setIsEditing(false);
  };

  const save = () => {
    const saved = upsertSteepSlopeSafetyCard(draft);
    setIsEditing(false);
    onSelectId(saved.id);
  };

  const remove = () => {
    if (isCreate) {
      onSelectId(null);
      return;
    }
    if (!window.confirm("이 점검표를 삭제할까요? (프로토타입)")) return;
    removeSteepSlopeSafetyCard(cardId);
    onSelectId(null);
  };

  const attachItems = useMemo((): ServiceFilePreviewItem[] => {
    return (display.attachments ?? []).map((a) => ({
      url: a.url,
      fileName: a.fileName,
      kind: "image" as const,
    }));
  }, [display.attachments]);

  const pickPhotoSlot = (index: number) => {
    setPhotoSlotPickIndex(index);
    photoSlotInputRef.current?.click();
  };

  const handlePhotoSlotFiles = (files: FileList | null) => {
    const index = photoSlotPickIndex;
    setPhotoSlotPickIndex(null);
    const file = files?.[0];
    if (index == null || !file || !file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    setDraft((prev) => {
      const photos = prev.photos.slice();
      const cur = photos[index];
      if (!cur) return prev;
      photos[index] = { ...cur, url };
      return { ...prev, photos };
    });
  };

  const clearPhotoSlot = (index: number) => {
    setDraft((prev) => {
      const photos = prev.photos.slice();
      const cur = photos[index];
      if (!cur) return prev;
      photos[index] = { ...cur, url: "" };
      return { ...prev, photos };
    });
  };

  const handlePickAttachments = (files: FileList | null) => {
    if (!files?.length) return;
    setDraft((prev) => {
      const cur = prev.attachments ?? [];
      const room = Math.max(0, STEEP_SLOPE_ATTACHMENT_MAX - cur.length);
      if (room <= 0) return prev;
      const next: SteepSlopeAttachment[] = [];
      for (const file of Array.from(files)) {
        if (next.length >= room) break;
        if (!file.type.startsWith("image/")) continue;
        const fileName = file.name || "첨부.jpg";
        next.push({
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          fileName,
          label: steepSlopeAttachmentLabelFromFileName(fileName),
          url: URL.createObjectURL(file),
        });
      }
      if (!next.length) return prev;
      return { ...prev, attachments: [...cur, ...next] };
    });
  };

  const removeAttachment = (id: string) => {
    setDraft((prev) => ({
      ...prev,
      attachments: (prev.attachments ?? []).filter((a) => a.id !== id),
    }));
  };

  const setAttachmentLabel = (id: string, label: string) => {
    setDraft((prev) => ({
      ...prev,
      attachments: (prev.attachments ?? []).map((a) =>
        a.id === id ? { ...a, label } : a
      ),
    }));
  };

  const attachmentCount = (display.attachments ?? []).length;
  const canAddAttachment =
    isEditing && attachmentCount < STEEP_SLOPE_ATTACHMENT_MAX;

  return (
    <div className="standard-panel-root relative bg-muted">
      <div className="standard-panel-header bg-background">
        <span className="standard-panel-title truncate">
          {isCreate ? "급경사지 안전점검표 등록" : "급경사지 안전점검표"}
        </span>
        <div className="standard-detail-section-header-actions">
          {!isEditing ? (
            <>
              <button
                type="button"
                className={actionBtn}
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void printSteepSlopeSafetyCard(display).finally(() =>
                    setBusy(false)
                  );
                }}
              >
                <Printer className="h-3 w-3" />
                인쇄
              </button>
              <button
                type="button"
                className={actionBtn}
                disabled={busy}
                title="인쇄 창에서 PDF로 저장"
                onClick={() => {
                  setBusy(true);
                  void downloadSteepSlopeSafetyCardPdf(display).finally(() =>
                    setBusy(false)
                  );
                }}
              >
                <FileDown className="h-3 w-3" />
                PDF
              </button>
              <button type="button" className={actionBtn} onClick={beginEdit}>
                <Pencil className="h-3 w-3" />
                수정
              </button>
              <button type="button" className={actionBtn} onClick={remove}>
                <Trash2 className="h-3 w-3" />
                삭제
              </button>
            </>
          ) : (
            <>
              <button type="button" className={actionBtn} onClick={save}>
                <Save className="h-3 w-3" />
                저장
              </button>
              <button type="button" className={actionBtn} onClick={cancelEdit}>
                취소
              </button>
            </>
          )}
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onClose}
            title="닫기"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        <div className="rounded border border-border bg-background p-2 shadow-sm">
          <h2 className="mb-2 text-center text-sm font-bold tracking-tight">
            급경사지 안전점검표
          </h2>

          <table className="mb-2 w-full border-collapse text-[11px]">
            <tbody>
              <tr>
                <Th>점검일시</Th>
                <Td>
                  {isEditing ? (
                    <input
                      type="date"
                      className={cn(fieldClass, "input-date-compact")}
                      value={draft.inspectYmd}
                      onChange={(e) => setField("inspectYmd", e.target.value)}
                    />
                  ) : (
                    display.inspectYmd || "—"
                  )}
                </Td>
                <Th>급경사지명</Th>
                <Td>
                  {isEditing ? (
                    <input
                      className={fieldClass}
                      value={draft.siteName}
                      onChange={(e) => setField("siteName", e.target.value)}
                    />
                  ) : (
                    display.siteName || "—"
                  )}
                </Td>
              </tr>
              <tr>
                <Th>분류</Th>
                <Td>
                  {isEditing ? (
                    <input
                      className={fieldClass}
                      value={draft.category}
                      onChange={(e) => setField("category", e.target.value)}
                    />
                  ) : (
                    display.category || "—"
                  )}
                </Td>
                <Th>제원</Th>
                <Td>
                  {isEditing ? (
                    <div className="flex flex-wrap gap-1">
                      <input
                        className={cn(fieldClass, "w-16")}
                        placeholder="길이m"
                        value={draft.lengthM}
                        onChange={(e) => setField("lengthM", e.target.value)}
                      />
                      <input
                        className={cn(fieldClass, "w-16")}
                        placeholder="높이m"
                        value={draft.heightM}
                        onChange={(e) => setField("heightM", e.target.value)}
                      />
                      <input
                        className={cn(fieldClass, "w-16")}
                        placeholder="경사°"
                        value={draft.slopeDeg}
                        onChange={(e) => setField("slopeDeg", e.target.value)}
                      />
                    </div>
                  ) : (
                    formatSteepSlopeSpec(display) || "—"
                  )}
                </Td>
              </tr>
              <tr>
                <Th>점검장소</Th>
                <Td colSpan={3}>
                  {isEditing ? (
                    <input
                      className={fieldClass}
                      value={draft.address}
                      onChange={(e) => setField("address", e.target.value)}
                    />
                  ) : (
                    display.address || "—"
                  )}
                </Td>
              </tr>
              <tr>
                <Th>점검자</Th>
                <Td colSpan={3}>
                  {isEditing ? (
                    <div className="space-y-1">
                      {draft.inspectors.map((p, i) => (
                        <div key={i} className="flex flex-wrap gap-1">
                          <input
                            className={cn(fieldClass, "min-w-[7rem] flex-1")}
                            placeholder="소속"
                            value={p.org}
                            onChange={(e) => {
                              const next = draft.inspectors.slice();
                              next[i] = { ...p, org: e.target.value };
                              setField("inspectors", next);
                            }}
                          />
                          <input
                            className={cn(fieldClass, "w-20")}
                            placeholder="직위"
                            value={p.title}
                            onChange={(e) => {
                              const next = draft.inspectors.slice();
                              next[i] = { ...p, title: e.target.value };
                              setField("inspectors", next);
                            }}
                          />
                          <input
                            className={cn(fieldClass, "w-20")}
                            placeholder="성명"
                            value={p.name}
                            onChange={(e) => {
                              const next = draft.inspectors.slice();
                              next[i] = { ...p, name: e.target.value };
                              setField("inspectors", next);
                            }}
                          />
                        </div>
                      ))}
                      <button
                        type="button"
                        className="text-[10px] text-primary hover:underline"
                        onClick={() =>
                          setField("inspectors", [
                            ...draft.inspectors,
                            { org: "", title: "", name: "" },
                          ])
                        }
                      >
                        + 점검자 추가
                      </button>
                    </div>
                  ) : (
                    display.inspectors
                      .map((p) =>
                        `(소속) ${p.org || "—"} (직위) ${p.title || "—"} (성명) ${p.name || "—"}`
                      )
                      .join(" · ") || "—"
                  )}
                </Td>
              </tr>
            </tbody>
          </table>

          <div className="mb-1 text-[11px] font-semibold">세부점검사항</div>
          <div className="overflow-x-auto">
            <table className="mb-2 w-full min-w-[28rem] border-collapse text-[10px]">
              <thead>
                <tr className="bg-muted/80">
                  <th className="border border-border px-1 py-1 text-left font-medium" colSpan={2}>
                    점검사항
                  </th>
                  {(["yes", "no", "na"] as const).map((k) => (
                    <th
                      key={k}
                      className="border border-border px-0.5 py-1 text-center font-medium"
                    >
                      {STEEP_SLOPE_CHECK_VALUE_LABEL[k]}
                    </th>
                  ))}
                  <th className="border border-border px-1 py-1 text-left font-medium">
                    세부내용 및 조치계획
                  </th>
                </tr>
              </thead>
              <tbody>
                {STEEP_SLOPE_CHECK_GROUPS.map((g) => (
                  <GroupRows
                    key={g.key}
                    title={g.title}
                    items={g.items}
                    card={display}
                    editing={isEditing}
                    onCheck={setCheck}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="mb-1 text-[11px] font-semibold">【 기타 의견 】</div>
          {isEditing ? (
            <textarea
              className="mb-2 min-h-[4rem] w-full rounded border border-border bg-background p-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
              value={draft.otherOpinion}
              onChange={(e) => setField("otherOpinion", e.target.value)}
            />
          ) : (
            <div className="mb-2 min-h-[2.5rem] rounded border border-dashed border-border px-2 py-1.5 text-xs text-foreground">
              {display.otherOpinion || "—"}
            </div>
          )}

          <label className="mb-3 flex items-start gap-1.5 text-[10px] text-muted-foreground">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={display.expertFollowUp}
              disabled={!isEditing}
              onChange={(e) => setField("expertFollowUp", e.target.checked)}
            />
            <span>
              주요 구조부의 균열 등 중대 결함이 발견된 경우 민간전문가 및 점검장비를
              활용하여 확인점검 실시
            </span>
          </label>

          <div className="mb-1 text-[11px] font-semibold">□ 점검 결과 (사진)</div>
          {/* 원본: 시설물 전경 위·아래, 시점·종점 좌·우 */}
          <div className="flex flex-col gap-1.5">
            {[0, 1].map((i) => {
              const p = display.photos[i];
              if (!p) return null;
              return (
                <PhotoSlotCard
                  key={p.key}
                  label={p.label}
                  url={p.url}
                  tall
                  isEditing={isEditing}
                  onPick={() => pickPhotoSlot(i)}
                  onClear={() => clearPhotoSlot(i)}
                />
              );
            })}
            <div className="grid grid-cols-2 gap-1.5">
              {[2, 3].map((i) => {
                const p = display.photos[i];
                if (!p) return null;
                return (
                  <PhotoSlotCard
                    key={p.key}
                    label={p.label}
                    url={p.url}
                    isEditing={isEditing}
                    onPick={() => pickPhotoSlot(i)}
                    onClear={() => clearPhotoSlot(i)}
                  />
                );
              })}
            </div>
          </div>

          <section className="standard-detail-section-divider mt-2">
            <div className="standard-detail-section-header standard-detail-section-header-bleed">
              <button
                type="button"
                onClick={() => setAttachOpen((v) => !v)}
                className="standard-detail-section-toggle"
                title="첨부파일"
              >
                {attachOpen ? (
                  <ChevronDown className="standard-detail-section-chevron" />
                ) : (
                  <ChevronRight className="standard-detail-section-chevron" />
                )}
                <span className="standard-detail-section-toggle-label inline-flex items-center gap-1">
                  <Paperclip className="h-3.5 w-3.5" />
                  첨부파일
                  {` (${attachmentCount.toLocaleString()}/${STEEP_SLOPE_ATTACHMENT_MAX})`}
                </span>
              </button>
              {attachOpen && canAddAttachment ? (
                <div className="standard-detail-section-header-actions">
                  <button
                    type="button"
                    className={actionBtn}
                    onClick={() => attachInputRef.current?.click()}
                    title="등록"
                  >
                    <Plus className="h-3 w-3" />
                    등록
                  </button>
                </div>
              ) : null}
            </div>
            {attachOpen ? (
              attachItems.length === 0 ? (
                <p className="standard-detail-empty-dashed-compact py-2 text-[10px] leading-snug">
                  {isEditing
                    ? "등록을 눌러 세부·기타 사진을 넣으세요. (최대 6장, 인쇄에 포함)"
                    : "등록된 첨부파일이 없습니다."}
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-1">
                  {(display.attachments ?? []).map((item, index) => (
                    <div
                      key={item.id}
                      className="overflow-hidden rounded border border-border bg-background"
                    >
                      <div className="group relative h-[5.5rem]">
                        <button
                          type="button"
                          title={`${item.fileName} 미리보기`}
                          aria-label={`${item.fileName} 미리보기`}
                          onClick={() =>
                            setAttachPreview({ items: attachItems, index })
                          }
                          className="block h-full w-full"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={item.url}
                            alt=""
                            className="h-full w-full object-contain"
                          />
                        </button>
                        {isEditing ? (
                          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-end gap-0.5 p-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              type="button"
                              title="삭제"
                              aria-label="삭제"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeAttachment(item.id);
                              }}
                              className="pointer-events-auto rounded bg-background/90 p-0.5 text-muted-foreground shadow-sm ring-1 ring-border/80 hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ) : null}
                      </div>
                      <div className="border-t border-border px-1 py-0.5">
                        {isEditing ? (
                          <input
                            className={cn(fieldClass, "h-6 text-center text-[10px]")}
                            value={item.label ?? ""}
                            placeholder="인쇄 캡션"
                            onChange={(e) =>
                              setAttachmentLabel(item.id, e.target.value)
                            }
                          />
                        ) : (
                          <div className="truncate text-center text-[10px] text-muted-foreground">
                            {steepSlopeAttachmentCaption(item)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : null}
          </section>

          <input
            ref={photoSlotInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              handlePhotoSlotFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={attachInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              handlePickAttachments(e.target.files);
              e.target.value = "";
            }}
          />

          <p className="mt-2 text-[10px] text-muted-foreground">
            프로토타입 — 세션 중 저장만 유지됩니다.
          </p>
        </div>
      </div>
      {attachPreview ? (
        <ServiceFileImagePreview
          items={attachPreview.items}
          initialIndex={attachPreview.index}
          onClose={() => setAttachPreview(null)}
        />
      ) : null}
    </div>
  );
}

function PhotoSlotCard({
  label,
  url,
  tall,
  isEditing,
  onPick,
  onClear,
}: {
  label: string;
  url: string;
  tall?: boolean;
  isEditing: boolean;
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <div className="overflow-hidden rounded border border-border bg-muted/30">
      <div
        className={cn(
          "relative flex items-center justify-center bg-muted/40 text-[10px] text-muted-foreground",
          tall ? "h-28" : "h-24"
        )}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="h-full w-full object-contain" />
        ) : (
          "사진 없음"
        )}
        {isEditing ? (
          <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1 bg-background/85 p-0.5">
            <button
              type="button"
              className={cn(actionBtn, "h-6 px-1.5")}
              onClick={onPick}
            >
              {url ? "바꾸기" : "등록"}
            </button>
            {url ? (
              <button
                type="button"
                className={cn(actionBtn, "h-6 px-1.5")}
                onClick={onClear}
              >
                삭제
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="border-t border-border px-1 py-0.5 text-center text-[10px]">
        {label}
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="w-[18%] border border-border bg-muted/60 px-1.5 py-1 text-center font-semibold text-foreground">
      {children}
    </th>
  );
}

function Td({
  children,
  colSpan,
}: {
  children: React.ReactNode;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className="border border-border px-1.5 py-1 align-middle text-foreground"
    >
      {children}
    </td>
  );
}

function GroupRows({
  title,
  items,
  card,
  editing,
  onCheck,
}: {
  title: string;
  items: readonly { key: string; label: string }[];
  card: SteepSlopeSafetyCard;
  editing: boolean;
  onCheck: (
    key: string,
    patch: Partial<{ value: SteepSlopeCheckValue; note: string }>
  ) => void;
}) {
  return (
    <>
      <tr>
        <td
          colSpan={6}
          className="border border-border bg-muted/40 px-1.5 py-1 font-semibold text-foreground"
        >
          ○ {title}
        </td>
      </tr>
      {items.map((it, idx) => {
        const row = card.checks[it.key] ?? { value: "" as const, note: "" };
        return (
          <tr key={it.key}>
            <td className="w-6 border border-border px-0.5 py-1 text-center text-muted-foreground">
              {idx + 1}
            </td>
            <td className="border border-border px-1 py-1 text-left leading-snug">
              {it.label}
            </td>
            {(["yes", "no", "na"] as const).map((v) => (
              <td key={v} className="w-10 border border-border px-0.5 py-1 text-center">
                {editing ? (
                  <input
                    type="radio"
                    name={`chk-${it.key}`}
                    checked={row.value === v}
                    onChange={() => onCheck(it.key, { value: v })}
                    aria-label={STEEP_SLOPE_CHECK_VALUE_LABEL[v]}
                  />
                ) : row.value === v ? (
                  <span className="font-bold">✓</span>
                ) : (
                  ""
                )}
              </td>
            ))}
            <td className="border border-border px-1 py-1">
              {editing ? (
                <input
                  className={fieldClass}
                  value={row.note}
                  onChange={(e) => onCheck(it.key, { note: e.target.value })}
                />
              ) : (
                row.note || ""
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}
