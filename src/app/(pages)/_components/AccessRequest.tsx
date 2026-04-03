'use client';

import { useEffect, useMemo, useState } from 'react';
import { call } from '@/lib/api';
import { Check, X } from 'lucide-react';
import { ACCESS_MODAL_OUTLINE_BTN_CLASS } from '@/lib/accessModalStyles';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog';
import { Button } from '@/app/shadcnComponents/ui/button';
import { cn } from '@/lib/utils';

const TEXTAREA_FIELD_CLASS = cn(
  'placeholder:text-muted-foreground border-input w-full min-w-0 rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow]',
  'focus-visible:border-primary focus-visible:ring-0',
  'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
  'dark:bg-input/30 resize-y min-h-[4.5rem] mt-1'
);

// ——— shared ———

type ConfigSystemRow = { sys_key?: string; sys_kor?: string };
type ConfigSerRow = { ser_eng?: string | null; ser_kor?: string | null; ser_is_private?: boolean | null };

async function permCall(action: string, params: Record<string, unknown> = {}) {
  const res = await call('', 'POST', { service: 'permissionService', action, params });
  if (!res?.success) throw new Error(res?.error ?? 'failed');
  return res.data;
}

async function fetchConfigLists(): Promise<{ systems: ConfigSystemRow[]; services: ConfigSerRow[] }> {
  try {
    const [sysRes, serRes] = await Promise.all([
      call('', 'POST', { service: 'configService', action: 'getSystemList', params: {} }),
      call('', 'POST', { service: 'configService', action: 'getServiceList', params: {} }),
    ]);
    const sysRaw = (sysRes as { data?: { systems?: ConfigSystemRow[] }; systems?: ConfigSystemRow[] })?.data ?? sysRes;
    const serRaw = (serRes as { data?: { ser?: ConfigSerRow[] }; ser?: ConfigSerRow[] })?.data ?? serRes;
    return {
      systems: Array.isArray(sysRaw?.systems) ? sysRaw.systems : [],
      services: Array.isArray(serRaw?.ser) ? serRaw.ser : [],
    };
  } catch {
    return { systems: [], services: [] };
  }
}

// ——— 접근 제한 경고 + 신청 (지도·인덱스) ———

type ResourceKind = 'system' | 'service';

const DENIED_MESSAGES: Record<ResourceKind, string> = {
  system: '시스템에 접속할 수 있는 권한이 없습니다. 권한을 신청하신 후 관리자에게 문의해 주세요.',
  service: '서비스를 이용할 수 있는 권한이 없습니다. 권한을 신청하신 후 관리자에게 문의해 주세요.',
};

type ResourceAccessDeniedDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resource: ResourceKind;
  serEng?: string;
  sysKey?: string;
};

export function ResourceAccessDeniedDialog({
  open,
  onOpenChange,
  resource,
  serEng,
  sysKey,
}: ResourceAccessDeniedDialogProps) {
  const [configSystems, setConfigSystems] = useState<ConfigSystemRow[]>([]);
  const [configServices, setConfigServices] = useState<ConfigSerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [requestReason, setRequestReason] = useState('');
  const [level, setLevel] = useState(3);
  const [msg, setMsg] = useState('');

  const sk = (sysKey ?? '').trim();
  const se = (serEng ?? '').trim();

  useEffect(() => {
    if (!open) {
      setRequestReason('');
      setMsg('');
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { systems, services } = await fetchConfigLists();
      if (cancelled) return;
      setConfigSystems(systems);
      setConfigServices(services);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const targetDisplay = useMemo(() => {
    if (resource === 'system') {
      if (!sk) return '—';
      return (
        configSystems.find((row) => String(row.sys_key ?? '').trim() === sk)?.sys_kor?.trim() || sk
      );
    }
    if (!se) return '—';
    return (
      configServices.find((row) => String(row.ser_eng ?? '').trim() === se)?.ser_kor?.trim() || se
    );
  }, [resource, sk, se, configSystems, configServices]);

  async function submitDenied() {
    setMsg('');
    try {
      if (resource === 'system') {
        await permCall('submitAccessRequest', {
          targetType: 'sys',
          sysKey: sk,
          requestReason: requestReason.trim() || undefined,
        });
      } else {
        await permCall('submitAccessRequest', {
          targetType: 'ser',
          serEng: se,
          requestedSerpType: level,
          requestReason: requestReason.trim() || undefined,
        });
      }
      setMsg('신청되었습니다.');
      setRequestReason('');
      window.setTimeout(() => onOpenChange(false), 1400);
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : '오류');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn('rounded-md sm:max-w-md max-h-[90vh] overflow-y-auto')}
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle className="text-base leading-snug flex items-center gap-2.5 font-semibold">
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white dark:bg-emerald-500"
              aria-hidden
            >
              <Check className="h-3 w-3" strokeWidth={3} />
            </span>
            접근권한 신청
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground leading-relaxed py-1">{DENIED_MESSAGES[resource]}</p>

        {loading ? (
          <p className="text-sm text-muted-foreground py-1">불러오는 중…</p>
        ) : (
          <div className="space-y-3 pt-1">
            <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-3">
              <span className="text-sm font-medium shrink-0 text-foreground">신청대상</span>
              <span className="min-w-0 flex-1 text-sm text-foreground">{targetDisplay}</span>
            </div>
            {resource === 'service' && (
              <div className="space-y-1.5">
                <label htmlFor="denied-level" className="text-sm font-medium">
                  요청 단계
                </label>
                <select
                  id="denied-level"
                  className="w-full rounded-md border border-input bg-background p-2 text-sm h-9 mt-1"
                  value={level}
                  onChange={(e) => setLevel(Number(e.target.value))}
                >
                  <option value={2}>데이터 조회</option>
                  <option value={3}>데이터 추가, 수정, 삭제</option>
                </select>
              </div>
            )}
            <div className="space-y-1.5 w-full">
              <label htmlFor="denied-reason" className="text-sm font-medium">
                신청사유
              </label>
              <textarea
                id="denied-reason"
                rows={7}
                value={requestReason}
                onChange={(e) => setRequestReason(e.target.value)}
                placeholder="신청 사유를 입력해 주세요"
                className={TEXTAREA_FIELD_CLASS}
                maxLength={4000}
              />
            </div>
          </div>
        )}

        {msg ? <p className="text-sm text-muted-foreground">{msg}</p> : null}

        <DialogFooter className="flex flex-col gap-2 items-end sm:flex-row sm:justify-end sm:items-center sm:gap-2 sm:pt-1">
          <Button
            type="button"
            variant="outline"
            className={ACCESS_MODAL_OUTLINE_BTN_CLASS}
            onClick={() => void submitDenied()}
            disabled={loading}
          >
            <Check className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
            권한신청
          </Button>
          <Button
            type="button"
            variant="outline"
            className={ACCESS_MODAL_OUTLINE_BTN_CLASS}
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            <X className="h-4 w-4 shrink-0" aria-hidden />
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ——— 전용 페이지 (/access-requests) ———

export type AccessRequestFormProps = {
  lockType?: 'ser' | 'sys';
  initialSerEng?: string;
  initialSysKey?: string;
  initialTab?: 'ser' | 'sys';
  className?: string;
};

export function AccessRequestForm({
  lockType,
  initialSerEng = '',
  initialSysKey = '',
  initialTab,
  className = '',
}: AccessRequestFormProps) {
  const [configSystems, setConfigSystems] = useState<ConfigSystemRow[]>([]);
  const [configServices, setConfigServices] = useState<ConfigSerRow[]>([]);
  const [tt, setTt] = useState<'ser' | 'sys'>(() =>
    lockType ?? (initialTab === 'sys' ? 'sys' : 'ser')
  );
  const [serEng, setSerEng] = useState(initialSerEng);
  const [sysKey, setSysKey] = useState(initialSysKey);
  const [level, setLevel] = useState(3);
  const [requestReason, setRequestReason] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { systems, services } = await fetchConfigLists();
      if (cancelled) return;
      setConfigSystems(systems);
      setConfigServices(services);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSysKey(initialSysKey.trim());
  }, [initialSysKey]);

  useEffect(() => {
    setSerEng(initialSerEng.trim());
  }, [initialSerEng]);

  useEffect(() => {
    if (lockType) return;
    setTt(initialTab === 'sys' ? 'sys' : 'ser');
  }, [initialTab, lockType]);

  async function submitPage() {
    setMsg('');
    try {
      if (tt === 'ser') {
        await permCall('submitAccessRequest', {
          targetType: 'ser',
          serEng,
          requestedSerpType: level,
          requestReason: requestReason.trim() || undefined,
        });
      } else {
        await permCall('submitAccessRequest', {
          targetType: 'sys',
          sysKey: sysKey.trim(),
          requestReason: requestReason.trim() || undefined,
        });
      }
      setMsg('신청되었습니다.');
      setRequestReason('');
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : '오류');
    }
  }

  const showToggle = !lockType;

  const sysDisplayName = useMemo(() => {
    const k = sysKey.trim();
    if (!k) return '—';
    return (
      configSystems.find((row) => String(row.sys_key ?? '').trim() === k)?.sys_kor?.trim() || k
    );
  }, [sysKey, configSystems]);

  const serDisplayName = useMemo(() => {
    const e = serEng.trim();
    if (!e) return '—';
    return (
      configServices.find((row) => String(row.ser_eng ?? '').trim() === e)?.ser_kor?.trim() || e
    );
  }, [serEng, configServices]);

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <h2 className="text-base font-semibold">서비스 이용신청</h2>
      {loading ? (
        <p className="text-sm text-muted-foreground py-2">불러오는 중…</p>
      ) : (
        <>
          {showToggle && (
            <div className="flex gap-2">
              <Button variant={tt === 'ser' ? 'default' : 'outline'} size="sm" onClick={() => setTt('ser')}>
                서비스
              </Button>
              <Button variant={tt === 'sys' ? 'default' : 'outline'} size="sm" onClick={() => setTt('sys')}>
                시스템
              </Button>
            </div>
          )}
          {tt === 'ser' ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-3">
                <span className="text-sm font-medium shrink-0 text-foreground">신청대상</span>
                <span className="min-w-0 flex-1 text-sm text-foreground">{serDisplayName}</span>
              </div>
              <label className="text-sm font-medium">요청 단계</label>
              <select
                className="w-full rounded-md border border-input bg-background p-2 text-sm"
                value={level}
                onChange={(e) => setLevel(Number(e.target.value))}
              >
                <option value={1}>버튼보기</option>
                <option value={2}>읽기</option>
                <option value={3}>쓰기</option>
              </select>
              <div className="space-y-1.5 w-full">
                <label htmlFor="access-req-reason-ser" className="text-sm font-medium">
                  신청사유
                </label>
                <textarea
                  id="access-req-reason-ser"
                  rows={3}
                  value={requestReason}
                  onChange={(e) => setRequestReason(e.target.value)}
                  placeholder="신청 사유를 입력해 주세요"
                  className={TEXTAREA_FIELD_CLASS}
                  maxLength={4000}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-3">
                <span className="text-sm font-medium shrink-0 text-foreground">신청대상</span>
                <span className="min-w-0 flex-1 text-sm text-foreground">{sysDisplayName}</span>
              </div>
              <div className="space-y-1.5 w-full">
                <label htmlFor="access-req-reason-sys" className="text-sm font-medium">
                  신청사유
                </label>
                <textarea
                  id="access-req-reason-sys"
                  rows={3}
                  value={requestReason}
                  onChange={(e) => setRequestReason(e.target.value)}
                  placeholder="신청 사유를 입력해 주세요"
                  className={TEXTAREA_FIELD_CLASS}
                  maxLength={4000}
                />
              </div>
            </div>
          )}
          {msg ? <p className="text-sm text-muted-foreground">{msg}</p> : null}
          <Button type="button" className="rounded-md w-fit" onClick={() => void submitPage()}>
            권한신청
          </Button>
        </>
      )}
    </div>
  );
}
