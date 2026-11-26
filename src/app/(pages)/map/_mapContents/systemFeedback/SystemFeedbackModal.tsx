'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { call } from '@/lib/api';
import { appFetch, getBasePath } from '@/lib/basePath';
import { isSuperUser } from '@/lib/auth/superUser';
import { getOpenedKeyForSerEng } from '@/lib/mapServiceOpened';
import { SER_FILE_ENG } from '@/lib/serviceFileDataSerEng';
import { cn } from '@/lib/utils';
import { MapFloatingPanel } from '@/app/(pages)/map/_mapComponents/MapFloatingPanel';
import { serviceFileDataDownloadUrl } from '@/app/(pages)/map/_mapComponents/standard/useServiceFileData';
import {
  submitSystemFeedbackToGnms,
  type GnmsSystemFeedbackFile,
} from '@/lib/gnmsSystemFeedbackBrowser';
import { SystemFeedbackAttachments } from './SystemFeedbackAttachments';
import { SystemFeedbackEditor } from './SystemFeedbackEditor';

const PAGE_SIZE = 10;
const FILE_LAYER = 'system_feedback';
const EDITOR_SUB = 'editor';

type ServiceOpt = { ser_eng: string; ser_kor: string };
type ListItem = {
  sfKey: number;
  usrId: string;
  usrName: string;
  systemKey: string | null;
  serviceEng: string | null;
  serviceKor: string | null;
  status: string;
  gnmsSent: boolean;
  gnmsSentAt: string | null;
  gnmsError: string | null;
  sfCreateDate: string | null;
  dateLabel: string;
  preview: string;
};

type Detail = ListItem & { contentHtml: string | null };

type Props = {
  open: boolean;
  onClose: () => void;
};

const NONE = '';

/** call → { success, data: serviceReturn } 이고 serviceReturn 이 { ok, data } 인 경우 */
function unwrapServiceData<T>(res: unknown): T | null {
  const outer = (res as { data?: unknown } | null)?.data ?? res;
  if (outer && typeof outer === 'object' && 'data' in (outer as object)) {
    return ((outer as { data: T }).data ?? null) as T | null;
  }
  return (outer as T) ?? null;
}

async function listServiceFileNames(sfKey: number, subfolder?: string): Promise<string[]> {
  const qs = new URLSearchParams({
    serEng: SER_FILE_ENG.systemFeedback,
    layer: FILE_LAYER,
    key: String(sfKey),
    meta: '0',
  });
  if (subfolder) qs.set('subfolder', subfolder);
  const res = await appFetch(`/api/service-files?${qs.toString()}`, { credentials: 'include' });
  if (!res.ok) return [];
  const data = (await res.json().catch(() => ({}))) as { files?: { name?: string }[] };
  return Array.isArray(data.files)
    ? data.files.map((f) => String(f.name ?? '').trim()).filter(Boolean)
    : [];
}

/** 재전송용 — 저장된 첨부·에디터 이미지를 Blob으로 수집 */
async function collectGnmsFilesForResend(sfKey: number): Promise<GnmsSystemFeedbackFile[]> {
  const out: GnmsSystemFeedbackFile[] = [];
  const attachNames = await listServiceFileNames(sfKey);
  for (const name of attachNames) {
    const url = serviceFileDataDownloadUrl(SER_FILE_ENG.systemFeedback, FILE_LAYER, sfKey, name);
    const r = await appFetch(url, { credentials: 'include' });
    if (!r.ok) continue;
    out.push({ fieldName: 'attachments', file: await r.blob(), fileName: name });
  }
  const editorNames = await listServiceFileNames(sfKey, EDITOR_SUB);
  for (const name of editorNames) {
    const url = serviceFileDataDownloadUrl(SER_FILE_ENG.systemFeedback, FILE_LAYER, sfKey, name, {
      subfolder: EDITOR_SUB,
    });
    const r = await appFetch(url, { credentials: 'include' });
    if (!r.ok) continue;
    out.push({ fieldName: 'editorImages', file: await r.blob(), fileName: name });
  }
  return out;
}

function shortDateLabel(item: ListItem): string {
  const raw = item.sfCreateDate || item.dateLabel || '';
  const m = String(raw).match(/^(\d{4}-\d{2}-\d{2})/);
  return m?.[1] ?? (item.dateLabel || '-');
}

export function SystemFeedbackModal({ open, onClose }: Props) {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const systemKey = String(searchParams.get('system') ?? '').trim();
  const openedToken = String(searchParams.get('opened') ?? '').trim();

  const usrId = String(session?.user?.id ?? '').trim();
  const usrName = String(session?.user?.name ?? '').trim() || usrId || '사용자';
  const superUser = isSuperUser(usrId);

  const [serviceOpts, setServiceOpts] = useState<ServiceOpt[]>([]);
  const [serviceEng, setServiceEng] = useState(NONE);
  const [sfKey, setSfKey] = useState<number | null>(null);
  const [contentHtml, setContentHtml] = useState('');
  const [mode, setMode] = useState<'create' | 'view'>('create');
  const [list, setList] = useState<ListItem[]>([]);
  const [listTotal, setListTotal] = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [listPage, setListPage] = useState(1);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [keyword, setKeyword] = useState('');
  const [draftLoading, setDraftLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [listPanelOpen, setListPanelOpen] = useState(true);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [viewDetail, setViewDetail] = useState<Detail | null>(null);

  const attachmentFilesRef = useRef<File[]>([]);
  const editorImageFilesRef = useRef<{ file: File; url: string }[]>([]);
  const draftKeyRef = useRef<number | null>(null);

  const serviceKor = useMemo(() => {
    if (!serviceEng) return '선택 없음';
    return serviceOpts.find((s) => s.ser_eng === serviceEng)?.ser_kor ?? serviceEng;
  }, [serviceEng, serviceOpts]);

  const defaultServiceEng = useMemo(() => {
    if (!openedToken || !serviceOpts.length) return NONE;
    const match = serviceOpts.find((s) => getOpenedKeyForSerEng(s.ser_eng) === openedToken);
    return match?.ser_eng ?? NONE;
  }, [openedToken, serviceOpts]);

  const loadServices = useCallback(async () => {
    try {
      const [serRes, sysRes] = await Promise.all([
        call('', 'POST', { service: 'configService', action: 'getServiceList', params: {} }),
        call('', 'POST', { service: 'configService', action: 'getSystemList', params: {} }),
      ]);
      const serData = serRes?.data ?? serRes;
      const ser = Array.isArray(serData?.ser) ? serData.ser : [];
      const map = new Map<string, ServiceOpt>();
      for (const s of ser) {
        const eng = String(s.ser_eng ?? '').trim();
        const kor = String(s.ser_kor ?? '').trim() || eng;
        if (eng) map.set(eng, { ser_eng: eng, ser_kor: kor });
      }
      const sysData = sysRes?.data ?? sysRes;
      const systems = Array.isArray(sysData?.systems) ? sysData.systems : [];
      const current = systems.find(
        (s: { sys_key?: string }) => String(s.sys_key ?? '').trim() === systemKey
      );
      const engs: string[] = Array.isArray(current?.serviceList)
        ? current.serviceList.map((k: string) => String(k).trim()).filter(Boolean)
        : [];
      const opts = engs.map((eng) => map.get(eng) ?? { ser_eng: eng, ser_kor: eng });
      setServiceOpts(opts);
    } catch {
      setServiceOpts([]);
    }
  }, [systemKey]);

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await call('', 'POST', {
        service: 'systemFeedbackService',
        action: 'list',
        params: {
          limit: PAGE_SIZE,
          offset: (listPage - 1) * PAGE_SIZE,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          q: keyword.trim() || undefined,
        },
      });
      const data = unwrapServiceData<{ items?: ListItem[]; total?: number }>(res);
      setList(Array.isArray(data?.items) ? data.items : []);
      setListTotal(Number(data?.total ?? 0));
    } catch {
      setList([]);
      setListTotal(0);
    } finally {
      setListLoading(false);
    }
  }, [listPage, dateFrom, dateTo, keyword]);

  const pageCount = Math.max(1, Math.ceil(listTotal / PAGE_SIZE) || 1);
  const safePage = Math.min(listPage, pageCount);
  const listFrom = listTotal === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const listTo = Math.min(safePage * PAGE_SIZE, listTotal);
  const hasNextPage = safePage * PAGE_SIZE < listTotal;
  const showResend =
    mode === 'view' && viewDetail != null && !viewDetail.gnmsSent;

  const startNewDraft = useCallback(async () => {
    setDraftLoading(true);
    setStatusMsg(null);
    setMode('create');
    setViewDetail(null);
    setContentHtml('');
    attachmentFilesRef.current = [];
    editorImageFilesRef.current = [];
    try {
      if (draftKeyRef.current) {
        await call('', 'POST', {
          service: 'systemFeedbackService',
          action: 'discardDraft',
          params: { sfKey: draftKeyRef.current },
        }).catch(() => {});
        draftKeyRef.current = null;
      }
      const res = await call('', 'POST', {
        service: 'systemFeedbackService',
        action: 'createDraft',
        params: {
          usrName,
          systemKey: systemKey || null,
          serviceEng: defaultServiceEng || null,
          serviceKor:
            defaultServiceEng
              ? serviceOpts.find((s) => s.ser_eng === defaultServiceEng)?.ser_kor ?? defaultServiceEng
              : '선택 없음',
        },
      });
      const data = unwrapServiceData<Detail>(res);
      const key = Number(data?.sfKey ?? 0);
      if (!key) throw new Error('초안 생성 실패');
      setSfKey(key);
      draftKeyRef.current = key;
      setServiceEng(defaultServiceEng);
    } catch (e) {
      setSfKey(null);
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === 'object' && e && 'error' in e
            ? String((e as { error: unknown }).error)
            : '초안 생성 실패';
      setStatusMsg(msg);
    } finally {
      setDraftLoading(false);
    }
  }, [usrName, systemKey, defaultServiceEng, serviceOpts]);

  useEffect(() => {
    if (!open) return;
    void loadServices();
  }, [open, loadServices]);

  useEffect(() => {
    if (!open) return;
    setListPage(1);
    setDateFrom('');
    setDateTo('');
    setKeyword('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    void loadList();
  }, [open, loadList]);

  useEffect(() => {
    setListPage(1);
  }, [dateFrom, dateTo, keyword]);

  useEffect(() => {
    if (listPage > pageCount) setListPage(pageCount);
  }, [listPage, pageCount]);

  useEffect(() => {
    if (!open) return;
    void startNewDraft();
    return () => {
      const key = draftKeyRef.current;
      if (key) {
        draftKeyRef.current = null;
        void call('', 'POST', {
          service: 'systemFeedbackService',
          action: 'discardDraft',
          params: { sfKey: key },
        }).catch(() => {});
      }
    };
    // 모달 열릴 때만 초안
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleClose = () => {
    onClose();
  };

  const openDetail = async (item: ListItem) => {
    setMode('view');
    setStatusMsg(null);
    try {
      const res = await call('', 'POST', {
        service: 'systemFeedbackService',
        action: 'get',
        params: { sfKey: item.sfKey },
      });
      const data = unwrapServiceData<Detail>(res);
      if (!data) throw new Error('조회 실패');
      setViewDetail(data);
      setSfKey(data.sfKey);
      setContentHtml(data.contentHtml ?? '');
      setServiceEng(data.serviceEng ?? NONE);
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : '조회 실패');
    }
  };

  const handleListRowClick = (item: ListItem) => {
    if (mode === 'view' && viewDetail?.sfKey === item.sfKey) {
      void startNewDraft();
      return;
    }
    void openDetail(item);
  };

  const handleToggleListPanel = () => {
    if (listPanelOpen) {
      setListPanelOpen(false);
      void startNewDraft();
      return;
    }
    setListPanelOpen(true);
  };

  const loadSystemIdentity = async () => {
    let systemName = '';
    let systemKorName = '';
    try {
      const idRes = await call('', 'POST', {
        service: 'configService',
        action: 'getSystemIdentity',
        params: {},
      });
      const identity = ((idRes as { data?: { systemName?: string; systemKorName?: string } })
        ?.data ?? idRes) as { systemName?: string; systemKorName?: string };
      systemName = String(identity?.systemName ?? '').trim();
      systemKorName = String(identity?.systemKorName ?? '').trim();
    } catch {
      /* GNMS 파라미터만 */
    }
    return { systemName, systemKorName };
  };

  const handleSubmit = async () => {
    if (sfKey == null || mode !== 'create') return;
    const html = contentHtml.trim();
    if (!html || html === '<p></p>') {
      setStatusMsg('내용을 입력하세요.');
      return;
    }
    setSubmitting(true);
    setStatusMsg(null);
    try {
      const res = await call('', 'POST', {
        service: 'systemFeedbackService',
        action: 'submit',
        params: {
          sfKey,
          usrName,
          systemKey: systemKey || null,
          serviceEng: serviceEng || null,
          serviceKor,
          contentHtml: html,
        },
      });
      const data = unwrapServiceData<Detail>(res);
      if (!data?.sfKey) throw new Error('제출 실패');
      draftKeyRef.current = null;

      const files: GnmsSystemFeedbackFile[] = [];
      for (const f of attachmentFilesRef.current) {
        files.push({ fieldName: 'attachments', file: f, fileName: f.name });
      }
      for (const { file } of editorImageFilesRef.current) {
        files.push({ fieldName: 'editorImages', file, fileName: file.name });
      }

      const project = getBasePath().replace(/^\/+|\/+$/g, '') || undefined;
      const { systemName, systemKorName } = await loadSystemIdentity();

      try {
        await submitSystemFeedbackToGnms({
          payload: {
            sfKey: data.sfKey,
            usrId,
            usrName,
            systemKey: data.systemKey,
            serviceEng: data.serviceEng,
            serviceKor: data.serviceKor,
            contentHtml: data.contentHtml ?? html,
            systemName,
            systemKorName,
            project,
            createdAt: data.sfCreateDate,
          },
          files,
        });
        await call('', 'POST', {
          service: 'systemFeedbackService',
          action: 'markGnmsResult',
          params: { sfKey: data.sfKey, sent: true },
        });
        setStatusMsg('제출·GNMS 전송 완료');
      } catch (gnmsErr) {
        const msg = gnmsErr instanceof Error ? gnmsErr.message : 'GNMS 전송 실패';
        await call('', 'POST', {
          service: 'systemFeedbackService',
          action: 'markGnmsResult',
          params: { sfKey: data.sfKey, sent: false, error: msg },
        });
        setStatusMsg(`로컬 저장 완료. GNMS 전송 실패: ${msg}`);
      }

      attachmentFilesRef.current = [];
      editorImageFilesRef.current = [];
      await loadList();
      await startNewDraft();
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : '제출 실패');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (!viewDetail || viewDetail.gnmsSent) return;
    setResending(true);
    setStatusMsg(null);
    try {
      const files = await collectGnmsFilesForResend(viewDetail.sfKey);
      const project = getBasePath().replace(/^\/+|\/+$/g, '') || undefined;
      const { systemName, systemKorName } = await loadSystemIdentity();
      await submitSystemFeedbackToGnms({
        payload: {
          sfKey: viewDetail.sfKey,
          usrId: viewDetail.usrId || usrId,
          usrName: viewDetail.usrName || usrName,
          systemKey: viewDetail.systemKey,
          serviceEng: viewDetail.serviceEng,
          serviceKor: viewDetail.serviceKor,
          contentHtml: viewDetail.contentHtml ?? '',
          systemName,
          systemKorName,
          project,
          createdAt: viewDetail.sfCreateDate,
        },
        files,
      });
      const markRes = await call('', 'POST', {
        service: 'systemFeedbackService',
        action: 'markGnmsResult',
        params: { sfKey: viewDetail.sfKey, sent: true },
      });
      const marked = unwrapServiceData<Detail>(markRes);
      if (marked) setViewDetail(marked);
      else setViewDetail((prev) => (prev ? { ...prev, gnmsSent: true, gnmsError: null } : prev));
      setStatusMsg('GNMS 재전송 완료');
      await loadList();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'GNMS 재전송 실패';
      await call('', 'POST', {
        service: 'systemFeedbackService',
        action: 'markGnmsResult',
        params: { sfKey: viewDetail.sfKey, sent: false, error: msg },
      }).catch(() => {});
      setStatusMsg(`재전송 실패: ${msg}`);
      await loadList();
    } finally {
      setResending(false);
    }
  };

  if (!open) return null;

  return (
    <MapFloatingPanel
      viewport
      zLayer="viewportFloating"
      variant="mapFloat"
      width={listPanelOpen ? '980px' : '560px'}
      maxHeight="min(600px, calc(100vh - 48px))"
      style={{ height: 'min(600px, calc(100vh - 48px))' }}
      className="!bg-white !opacity-100 dark:!bg-background"
      defaultPosition={{ top: 56, left: 80 }}
      headerClassName="border-b border-slate-200 dark:border-white/10"
      header={
        <div className="flex w-full items-center justify-between gap-2">
          <span className="standard-map-float-header-title">시스템 불편신고</span>
          <button
            type="button"
            title="닫기"
            className="standard-map-float-header-close"
            onClick={handleClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 gap-0 overflow-hidden bg-white dark:bg-background">
        {/* 좌: 작성/상세 */}
        <div
          className={cn(
            'flex min-h-0 min-w-0 flex-col bg-white dark:bg-background',
            listPanelOpen ? 'flex-[3] border-r border-border' : 'flex-1'
          )}
        >
          <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border bg-slate-100 px-2.5 dark:bg-white/10">
            <p className="text-xs font-medium text-foreground">작성 내용</p>
            <button
              type="button"
              title={listPanelOpen ? '목록 접기' : '목록 펼치기'}
              className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              onClick={handleToggleListPanel}
            >
              {listPanelOpen ? (
                <PanelRightClose className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <PanelRightOpen className="h-3.5 w-3.5" aria-hidden />
              )}
              <span className="sr-only">{listPanelOpen ? '목록 접기' : '목록 펼치기'}</span>
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-3 py-2.5">
            <label className="block shrink-0 space-y-1">
              <span className="text-xs font-medium text-muted-foreground">기능</span>
              <select
                className="h-8 w-full cursor-pointer rounded border border-input bg-white px-2 text-xs disabled:opacity-70 dark:bg-background"
                value={serviceEng}
                disabled={mode === 'view' || draftLoading}
                onChange={(e) => setServiceEng(e.target.value)}
                title="기능 선택"
              >
                <option value={NONE}>선택 없음</option>
                {serviceOpts.map((s) => (
                  <option key={s.ser_eng} value={s.ser_eng}>
                    {s.ser_kor}
                  </option>
                ))}
              </select>
            </label>

            <label className="block shrink-0 space-y-1">
              <span className="text-xs font-medium text-muted-foreground">작성자</span>
              <input
                type="text"
                value={mode === 'view' ? viewDetail?.usrName ?? usrName : usrName}
                disabled
                title="작성자"
                className="h-8 w-full rounded border border-input bg-white px-2 text-xs text-foreground disabled:cursor-not-allowed disabled:bg-slate-50 dark:bg-background dark:disabled:bg-muted/40"
              />
            </label>

            <div className="flex min-h-0 flex-1 flex-col gap-1">
              <span className="shrink-0 text-xs font-medium text-muted-foreground">내용</span>
              {draftLoading ? (
                <div className="flex min-h-0 flex-1 items-center gap-2 rounded border border-border px-3 text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  초안 준비 중…
                </div>
              ) : (
                <SystemFeedbackEditor
                  key={mode === 'view' ? `view-${sfKey}` : `create-${sfKey}`}
                  className="min-h-0 flex-1"
                  sfKey={mode === 'create' ? sfKey : null}
                  contentHtml={contentHtml}
                  onChange={setContentHtml}
                  readOnly={mode === 'view'}
                  onEditorImageFile={(file, url) => {
                    editorImageFilesRef.current = [
                      ...editorImageFilesRef.current.filter((x) => x.url !== url),
                      { file, url },
                    ];
                  }}
                />
              )}
            </div>

            <SystemFeedbackAttachments
              sfKey={sfKey}
              canEdit={mode === 'create'}
              onLocalFiles={(files) => {
                const next = [...attachmentFilesRef.current];
                for (const file of files) {
                  const i = next.findIndex((f) => f.name === file.name);
                  if (i >= 0) next[i] = file;
                  else next.push(file);
                }
                attachmentFilesRef.current = next;
              }}
            />

            {statusMsg ? (
              <p className="shrink-0 text-xs text-muted-foreground">{statusMsg}</p>
            ) : null}
          </div>

          {mode === 'create' ? (
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-slate-50 px-3 py-2 dark:bg-white/5">
              <button
                type="button"
                title="제출"
                disabled={submitting || draftLoading || sfKey == null}
                className="inline-flex h-7 cursor-pointer items-center gap-1 rounded border border-primary bg-primary px-2.5 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                onClick={() => void handleSubmit()}
              >
                {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                제출
              </button>
            </div>
          ) : null}
        </div>

        {/* 우: 목록 */}
        <div
          className={cn(
            'flex min-h-0 min-w-0 flex-col bg-white dark:bg-background',
            listPanelOpen ? 'flex-[2]' : 'hidden w-0 overflow-hidden'
          )}
          aria-hidden={!listPanelOpen}
        >
          <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border bg-slate-100 px-2.5 dark:bg-white/10">
            <p className="text-xs font-medium text-foreground">
              {superUser ? '전체 신고 목록' : '내 신고 목록'}
            </p>
            <button
              type="button"
              title="새로고침"
              className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              onClick={() => void loadList()}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', listLoading && 'animate-spin')} />
            </button>
          </div>

          <div className="flex shrink-0 flex-col gap-1.5 border-b border-border px-2.5 py-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0 text-xs font-medium text-muted-foreground">날짜</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                title="시작일"
                className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-1.5 text-xs text-foreground outline-none scheme-light dark:scheme-dark"
              />
              <span className="shrink-0 text-xs text-muted-foreground">~</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                title="종료일"
                className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-1.5 text-xs text-foreground outline-none scheme-light dark:scheme-dark"
              />
            </div>
            <div className="standard-search-wrap">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                type="search"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="통합검색"
                title="통합검색"
                className="h-7 w-full rounded border border-border bg-background py-1 pl-7 pr-2 text-xs text-foreground outline-none focus:border-border focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          <div className="standard-list-body">
            <div className="standard-list-scroll">
              <table className="standard-list-table text-xs">
                <colgroup>
                  <col className="w-[22%]" />
                  <col />
                  <col className="w-[22%]" />
                  <col className="w-[18%]" />
                </colgroup>
                <thead className="standard-table-thead">
                  <tr>
                    <th className="standard-table-th standard-table-th-left">기능</th>
                    <th className="standard-table-th standard-table-th-left">내용</th>
                    <th className="standard-table-th standard-table-th-left">작성일</th>
                    <th className="standard-table-th standard-table-th-center">전송상태</th>
                  </tr>
                </thead>
                <tbody>
                  {listLoading && list.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="standard-table-loading-cell text-xs">
                        불러오는 중…
                      </td>
                    </tr>
                  ) : list.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="standard-table-empty">
                        제출된 신고가 없습니다.
                      </td>
                    </tr>
                  ) : (
                    list.map((item) => {
                      const active = mode === 'view' && viewDetail?.sfKey === item.sfKey;
                      return (
                        <tr
                          key={item.sfKey}
                          title={item.preview}
                          className={cn(
                            'standard-list-row',
                            active && 'standard-list-row-selected'
                          )}
                          onClick={() => handleListRowClick(item)}
                        >
                          <td className="standard-table-td-compact font-medium text-foreground">
                            {item.serviceKor || '선택 없음'}
                          </td>
                          <td className="standard-table-td-compact text-muted-foreground">
                            {item.preview}
                          </td>
                          <td className="standard-table-td-compact tabular-nums text-muted-foreground">
                            {shortDateLabel(item)}
                          </td>
                          <td className="standard-table-td-compact text-center">
                            <span
                              className={cn(
                                'text-xs font-medium',
                                item.gnmsSent ? 'text-emerald-600' : 'text-amber-600'
                              )}
                            >
                              {item.gnmsSent ? '성공' : '전송오류'}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="standard-list-footer flex min-w-0 items-center justify-between gap-1 text-xs">
              <span className="min-w-0 truncate tabular-nums">
                {listTotal === 0
                  ? '0건'
                  : `${listFrom}–${listTo} / ${listTotal.toLocaleString()}건`}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  title="이전"
                  disabled={safePage <= 1 || listLoading}
                  className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded border border-border bg-background text-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => setListPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="px-0.5 text-xs text-muted-foreground">{safePage}페이지</span>
                <button
                  type="button"
                  title="다음"
                  disabled={!hasNextPage || listLoading}
                  className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded border border-border bg-background text-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => setListPage((p) => p + 1)}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-slate-50 px-3 py-2 dark:bg-white/5">
              {showResend ? (
                <button
                  type="button"
                  title="재전송"
                  disabled={resending}
                  className="inline-flex h-7 cursor-pointer items-center gap-1 rounded border border-amber-600 bg-amber-600 px-2.5 text-xs font-medium text-white hover:bg-amber-600/90 disabled:opacity-50"
                  onClick={() => void handleResend()}
                >
                  {resending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  재전송
                </button>
              ) : null}
              <button
                type="button"
                title="새 신고"
                className="inline-flex h-7 cursor-pointer items-center gap-1 rounded border border-primary bg-primary px-2.5 text-xs font-medium text-white hover:bg-primary/90"
                onClick={() => void startNewDraft()}
              >
                <Plus className="h-3 w-3" />
                새 신고
              </button>
            </div>
          </div>
        </div>
      </div>
    </MapFloatingPanel>
  );
}
