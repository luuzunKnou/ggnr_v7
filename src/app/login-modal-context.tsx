'use client';

import {
  createContext,
  useCallback,
  useContext,
  useState,
  useEffect,
  Suspense,
} from 'react';
import { useSession, signIn } from 'next-auth/react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/app/shadcnComponents/ui/dialog';
import { Button } from '@/app/shadcnComponents/ui/button';
import { Input } from '@/app/shadcnComponents/ui/input';

type LoginModalContextValue = {
  openLogin: () => void;
};

const LoginModalContext = createContext<LoginModalContextValue | null>(null);

export function useLoginModal() {
  const ctx = useContext(LoginModalContext);
  if (!ctx) return { openLogin: () => {} };
  return ctx;
}

function OpenFromUrlEffect({
  setOpen,
  setPendingNext,
}: {
  setOpen: (v: boolean) => void;
  setPendingNext: (v: string) => void;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    if (searchParams.get('openLogin') !== '1') return;
    const next = searchParams.get('next') ?? '';
    if (next.startsWith('/')) setPendingNext(next);
    setOpen(true);
    const u = new URL(window.location.href);
    u.searchParams.delete('openLogin');
    router.replace(u.pathname + (u.search ? u.search : ''), { scroll: false });
  }, [searchParams, router, setOpen, setPendingNext]);

  return null;
}

function LoginModalDialog({
  open,
  onOpenChange,
  pendingNext,
  onClearNext,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pendingNext: string;
  onClearNext: () => void;
}) {
  const { data: session } = useSession();
  const [usrId, setUsrId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (session?.user && open) {
      onOpenChange(false);
      onClearNext();
    }
  }, [session, open, onOpenChange, onClearNext]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await signIn('credentials', {
        usrId,
        password,
        redirect: false,
      });
      if (res?.error) {
        setError('아이디 또는 비밀번호가 올바르지 않습니다.');
        setLoading(false);
        return;
      }
      const dest =
        pendingNext && pendingNext.startsWith('/') ? pendingNext : '/';
      window.location.href = dest;
    } catch {
      setError('로그인에 실패했습니다.');
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>로그인</DialogTitle>
          <DialogDescription>시스템 계정으로 로그인하세요.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4 pt-2">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="space-y-2">
            <label className="text-sm font-medium">아이디</label>
            <Input
              name="usrId"
              autoComplete="username"
              value={usrId}
              onChange={(e) => setUsrId(e.target.value)}
              disabled={loading}
              autoFocus={open}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">비밀번호</label>
            <Input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? '처리 중…' : '로그인'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function LoginModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pendingNext, setPendingNext] = useState('');

  const openLogin = useCallback(() => {
    if (typeof window !== 'undefined') {
      const n = new URLSearchParams(window.location.search).get('next');
      if (n && n.startsWith('/')) setPendingNext(n);
    }
    setOpen(true);
  }, []);

  const onClearNext = useCallback(() => setPendingNext(''), []);

  return (
    <LoginModalContext.Provider value={{ openLogin }}>
      {children}
      <Suspense fallback={null}>
        <OpenFromUrlEffect setOpen={setOpen} setPendingNext={setPendingNext} />
      </Suspense>
      <LoginModalDialog
        open={open}
        onOpenChange={setOpen}
        pendingNext={pendingNext}
        onClearNext={onClearNext}
      />
    </LoginModalContext.Provider>
  );
}
