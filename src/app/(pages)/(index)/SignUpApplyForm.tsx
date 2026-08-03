'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Clock3, UserCheck } from 'lucide-react';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Input } from '@/app/shadcnComponents/ui/input';
import { call } from '@/lib/api';
import { cn } from '@/lib/utils';

type UgRow = { ugName: string };
type UtRow = { utName: string; ugName: string };

type FormState = {
  usr_id: string;
  usr_name: string;
  ug_name: string;
  ut_name: string;
  usr_tel: string;
  usr_mail: string;
  usr_pwd: string;
  usr_pwd_confirm: string;
  usr_etc: string;
};

const emptyForm = (): FormState => ({
  usr_id: '',
  usr_name: '',
  ug_name: '',
  ut_name: '',
  usr_tel: '',
  usr_mail: '',
  usr_pwd: '',
  usr_pwd_confirm: '',
  usr_etc: '',
});

export type SignUpApplyFormProps = {
  variant?: 'page' | 'modal';
  uiVariant?: 0 | 1 | 2 | 3 | 4 | 5;
  onRequestLogin?: () => void;
  onClose?: () => void;
};

export function SignUpApplyForm({
  variant = 'page',
  uiVariant = 0,
  onRequestLogin,
  onClose,
}: SignUpApplyFormProps = {}) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [ugList, setUgList] = useState<UgRow[]>([]);
  const [utList, setUtList] = useState<UtRow[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingMeta(true);
    call('', 'POST', { service: 'usrService', action: 'getUserMeta', params: {} })
      .then((res) => {
        if (cancelled) return;
        const meta = (res.data?.data ?? res.data ?? {}) as { ug?: UgRow[]; ut?: UtRow[] };
        setUgList(Array.isArray(meta.ug) ? meta.ug : []);
        setUtList(Array.isArray(meta.ut) ? meta.ut : []);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '부서·팀 목록 조회 실패');
      })
      .finally(() => {
        if (!cancelled) setLoadingMeta(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const utForUg = useMemo(() => {
    const ug = form.ug_name.trim();
    if (!ug) return utList;
    return utList.filter((t) => t.ugName === ug);
  }, [form.ug_name, utList]);

  const setField = (key: keyof FormState, value: string) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'ug_name' && prev.ut_name) {
        const stillOk = utList.some((t) => t.ugName === value && t.utName === prev.ut_name);
        if (!stillOk) next.ut_name = '';
      }
      return next;
    });
  };

  function isFormReady() {
    return Boolean(
      form.usr_id.trim() &&
        form.usr_name.trim() &&
        form.ug_name.trim() &&
        form.ut_name.trim() &&
        form.usr_pwd &&
        form.usr_pwd_confirm
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isFormReady()) {
      setError('필수 항목(아이디·이름·부서·팀·비밀번호)을 입력해 주세요.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await call('', 'POST', {
        service: 'usrService',
        action: 'submitSignUp',
        params: { ...form },
      });
      const inner = res.data ?? res;
      if (inner?.success === false) {
        setError(String(inner.error ?? '가입신청에 실패했습니다.'));
        return;
      }
      if (res.success === false) {
        setError(String(res.error ?? '가입신청에 실패했습니다.'));
        return;
      }
      setDone(true);
      setForm(emptyForm());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '가입신청에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    const SuccessIcon = uiVariant === 4 ? Clock3 : uiVariant === 5 ? UserCheck : CheckCircle2;

    return (
      <div
        className={cn(
          'space-y-4 text-sm',
          uiVariant === 1 && 'rounded-lg border bg-muted/35 p-5',
          uiVariant === 2 && 'py-4 text-center',
          uiVariant === 3 && 'overflow-hidden rounded-xl border bg-card p-5 shadow-sm',
          uiVariant === 4 && 'rounded-md border-l-4 border-l-primary bg-muted/25 px-5 py-4',
          uiVariant === 5 && 'rounded-xl border border-primary/25 bg-primary/5 p-5'
        )}
      >
        {uiVariant !== 0 ? (
          <div
            className={cn(
              'flex',
              uiVariant === 2 ? 'justify-center' : 'items-center gap-3'
            )}
          >
            <div
              className={cn(
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary',
                uiVariant === 3 && 'rounded-lg',
                uiVariant === 4 && 'h-9 w-9',
                uiVariant === 5 && 'bg-primary text-primary-foreground'
              )}
            >
              <SuccessIcon className="h-5 w-5" aria-hidden="true" />
            </div>
            {uiVariant !== 2 ? (
              <div>
                <p className="font-semibold text-foreground">가입신청이 접수되었습니다.</p>
                {uiVariant === 4 ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">현재 상태: 관리자 승인 대기</p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {uiVariant === 2 ? (
          <p className="text-base font-semibold text-foreground">가입신청이 완료되었습니다</p>
        ) : uiVariant === 0 ? (
          <p className="font-medium text-foreground">가입신청이 접수되었습니다.</p>
        ) : null}
        <p
          className={cn(
            'text-muted-foreground',
            uiVariant === 2 && 'mx-auto max-w-sm',
            uiVariant === 3 && 'rounded-md bg-muted/50 px-3 py-2',
            uiVariant === 5 && 'border-t border-primary/15 pt-3'
          )}
        >
          관리자 승인 후 로그인할 수 있습니다. 승인까지 기다려 주세요.
        </p>
        <div className={cn('flex flex-wrap gap-2', uiVariant === 2 && 'justify-center')}>
          {variant === 'modal' && onRequestLogin ? (
            <Button type="button" onClick={onRequestLogin}>
              로그인하기
            </Button>
          ) : null}
          {variant === 'modal' && onClose ? (
            <Button type="button" variant="outline" onClick={onClose}>
              닫기
            </Button>
          ) : (
            <Button asChild variant="outline">
              <Link href="/">홈으로</Link>
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className={cn(
        'space-y-3',
        uiVariant === 1 && 'rounded-lg border bg-muted/20 p-4',
        uiVariant === 2 && 'rounded-xl bg-muted/25 p-4',
        uiVariant === 3 && 'rounded-xl border p-4 shadow-sm',
        uiVariant === 4 && 'border-l-4 border-l-primary pl-4',
        uiVariant === 5 && 'rounded-xl border border-primary/20 bg-primary/5 p-4'
      )}
    >
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loadingMeta ? (
        <p className="text-sm text-muted-foreground">부서·팀 불러오는 중…</p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">
            아이디 <span className="text-destructive">*</span>
          </span>
          <Input
            value={form.usr_id}
            onChange={(e) => setField('usr_id', e.target.value)}
            autoComplete="username"
            required
            disabled={saving}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">
            이름 <span className="text-destructive">*</span>
          </span>
          <Input
            value={form.usr_name}
            onChange={(e) => setField('usr_name', e.target.value)}
            autoComplete="name"
            required
            disabled={saving}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">
            부서 <span className="text-destructive">*</span>
          </span>
          {ugList.length > 0 ? (
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              value={form.ug_name}
              onChange={(e) => setField('ug_name', e.target.value)}
              required
              disabled={saving}
            >
              <option value="">선택</option>
              {ugList.map((g) => (
                <option key={g.ugName} value={g.ugName}>
                  {g.ugName}
                </option>
              ))}
            </select>
          ) : (
            <Input
              value={form.ug_name}
              onChange={(e) => setField('ug_name', e.target.value)}
              placeholder="부서명 입력"
              required
              disabled={saving}
            />
          )}
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">
            팀 <span className="text-destructive">*</span>
          </span>
          {utForUg.length > 0 ? (
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              value={form.ut_name}
              onChange={(e) => setField('ut_name', e.target.value)}
              required
              disabled={saving || !form.ug_name}
            >
              <option value="">선택</option>
              {utForUg.map((t) => (
                <option key={`${t.ugName}:${t.utName}`} value={t.utName}>
                  {t.utName}
                </option>
              ))}
            </select>
          ) : (
            <Input
              value={form.ut_name}
              onChange={(e) => setField('ut_name', e.target.value)}
              placeholder="팀명 입력"
              required
              disabled={saving}
            />
          )}
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">전화번호</span>
          <Input
            value={form.usr_tel}
            onChange={(e) => setField('usr_tel', e.target.value)}
            autoComplete="tel"
            disabled={saving}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">이메일</span>
          <Input
            type="email"
            value={form.usr_mail}
            onChange={(e) => setField('usr_mail', e.target.value)}
            autoComplete="email"
            disabled={saving}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">
            비밀번호 <span className="text-destructive">*</span>
          </span>
          <Input
            type="password"
            value={form.usr_pwd}
            onChange={(e) => setField('usr_pwd', e.target.value)}
            autoComplete="new-password"
            required
            disabled={saving}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">
            비밀번호 확인 <span className="text-destructive">*</span>
          </span>
          <Input
            type="password"
            value={form.usr_pwd_confirm}
            onChange={(e) => setField('usr_pwd_confirm', e.target.value)}
            autoComplete="new-password"
            required
            disabled={saving}
          />
        </label>
      </div>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">비고</span>
        <Input
          value={form.usr_etc}
          onChange={(e) => setField('usr_etc', e.target.value)}
          disabled={saving}
        />
      </label>
      <Button
        type="submit"
        className="w-full"
        disabled={saving || loadingMeta}
        title="가입신청"
      >
        {saving ? '신청 중…' : '가입신청'}
      </Button>
      {variant === 'modal' && onRequestLogin ? (
        <p className="text-center text-sm text-muted-foreground">
          이미 계정이 있으신가요?{' '}
          <button
            type="button"
            className="text-foreground underline-offset-4 hover:underline"
            onClick={onRequestLogin}
          >
            로그인
          </button>
        </p>
      ) : null}
    </form>
  );
}
