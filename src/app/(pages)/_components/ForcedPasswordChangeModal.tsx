'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/app/shadcnComponents/ui/dialog';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Input } from '@/app/shadcnComponents/ui/input';
import { call } from '@/lib/api';

type ProfilePayload = {
  success?: boolean;
  data?: { mustChangePassword?: boolean };
};

function unwrapMustChange(res: unknown): boolean {
  const outer = res as { data?: ProfilePayload & { mustChangePassword?: boolean } };
  const inner = outer?.data;
  if (inner?.data?.mustChangePassword === true) return true;
  if (inner?.mustChangePassword === true) return true;
  return false;
}

function unwrapError(res: unknown): string | null {
  const outer = res as { success?: boolean; error?: string; data?: { success?: boolean; error?: string } };
  if (outer?.data?.success === false) return String(outer.data.error ?? '저장 실패');
  if (outer?.success === false) return String(outer.error ?? '저장 실패');
  return null;
}

/** 임시 비밀번호(아이디=성명)로 들어온 계정은 새 비밀번호를 정할 때까지 막는다. */
export function ForcedPasswordChangeModal() {
  const { data: session, status } = useSession();
  const usrId = String(session?.user?.id ?? '').trim();
  const [open, setOpen] = useState(false);
  const [newPwd, setNewPwd] = useState('');
  const [newPwdConfirm, setNewPwdConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (status !== 'authenticated' || !usrId || usrId === 'su') {
      setOpen(false);
      return;
    }
    let cancelled = false;
    void call('', 'POST', {
      service: 'usrService',
      action: 'getMyProfile',
      params: {},
    })
      .then((res) => {
        if (!cancelled) setOpen(unwrapMustChange(res));
      })
      .catch(() => {
        if (!cancelled) setOpen(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status, usrId]);

  useEffect(() => {
    if (!open) {
      setNewPwd('');
      setNewPwdConfirm('');
      setError('');
      setSaving(false);
    }
  }, [open]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const res = await call('', 'POST', {
        service: 'usrService',
        action: 'changeOwnPassword',
        params: { new_pwd: newPwd, new_pwd_confirm: newPwdConfirm },
      });
      const err = unwrapError(res);
      if (err) {
        setError(err);
        setSaving(false);
        return;
      }
      setOpen(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '비밀번호 변경에 실패했습니다.');
      setSaving(false);
    }
  }

  if (status !== 'authenticated' || !usrId || usrId === 'su') return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>비밀번호 변경</DialogTitle>
          <DialogDescription>
            처음 로그인하셨습니다. 아이디(성명)와 다른 비밀번호를 설정하세요.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4 pt-2">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="space-y-2">
            <label className="text-sm font-medium">새 비밀번호</label>
            <Input
              type="password"
              autoComplete="new-password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              disabled={saving}
              autoFocus={open}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">비밀번호 확인</label>
            <Input
              type="password"
              autoComplete="new-password"
              value={newPwdConfirm}
              onChange={(e) => setNewPwdConfirm(e.target.value)}
              disabled={saving}
            />
          </div>
          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? '저장 중…' : '저장 후 계속'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
