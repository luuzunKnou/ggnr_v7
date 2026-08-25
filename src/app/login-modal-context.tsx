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
import { SignUpApplyForm } from '@/app/(pages)/(index)/SignUpApplyForm';
import { call } from '@/lib/api';
import { AUTH_REQUIRED_EVENT } from '@/lib/authRequiredEvent';
import { withBasePathNav } from '@/lib/basePath';

type LoginModalContextValue = {
  openLogin: () => void;
  openSignUp: () => void;
};

const LoginModalContext = createContext<LoginModalContextValue | null>(null);

export function useLoginModal() {
  const ctx = useContext(LoginModalContext);
  if (!ctx) return { openLogin: () => {}, openSignUp: () => {} };
  return ctx;
}

function OpenFromUrlEffect({
  setLoginOpen,
  setSignUpOpen,
  setPendingNext,
}: {
  setLoginOpen: (v: boolean) => void;
  setSignUpOpen: (v: boolean) => void;
  setPendingNext: (v: string) => void;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const openLogin = searchParams.get('openLogin') === '1';
    const openSignUp = searchParams.get('openSignUp') === '1';
    if (!openLogin && !openSignUp) return;

    const next = searchParams.get('next') ?? '';
    if (next.startsWith('/')) setPendingNext(next);

    if (openSignUp) {
      setSignUpOpen(true);
      setLoginOpen(false);
    } else {
      setLoginOpen(true);
      setSignUpOpen(false);
    }

    const u = new URL(window.location.href);
    u.searchParams.delete('openLogin');
    u.searchParams.delete('openSignUp');
    router.replace(u.pathname + (u.search ? u.search : ''), { scroll: false });
  }, [searchParams, router, setLoginOpen, setSignUpOpen, setPendingNext]);

  return null;
}

function LoginModalDialog({
  open,
  onOpenChange,
  pendingNext,
  onClearNext,
  onOpenSignUp,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pendingNext: string;
  onClearNext: () => void;
  onOpenSignUp: () => void;
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

  useEffect(() => {
    if (!open) {
      setUsrId('');
      setPassword('');
      setError('');
      setLoading(false);
    }
  }, [open]);

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
        if (res.code === 'signup_rejected') {
          let reason = '';
          try {
            const hint = await call('', 'POST', {
              service: 'usrService',
              action: 'getSignUpRejectReason',
              params: { usr_id: usrId },
            });
            const inner = hint?.data as
              | { data?: { reason?: string | null }; success?: boolean }
              | undefined;
            reason = String(inner?.data?.reason ?? '').trim();
          } catch {
            reason = '';
          }
          setError(
            reason
              ? `반려되었습니다.\n사유: ${reason}\n재가입신청을 하시거나 담당자에게 문의하세요.`
              : '반려가 되었으니 재가입신청을 하시거나 담당자에게 문의하세요.'
          );
        } else if (res.code === 'signup_pending') {
          setError('승인대기중입니다.');
        } else {
          setError('아이디 또는 비밀번호가 올바르지 않습니다.');
        }
        setLoading(false);
        return;
      }
      const here =
        typeof window !== 'undefined'
          ? `${window.location.pathname}${window.location.search}`
          : '/';
      const dest =
        pendingNext && pendingNext.startsWith('/')
          ? pendingNext
          : here.startsWith('/')
            ? here
            : '/';
      window.location.href = withBasePathNav(dest);
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
          {error ? (
            <p className="whitespace-pre-wrap text-sm text-destructive">{error}</p>
          ) : null}
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
          <p className="text-center text-sm text-muted-foreground">
            계정이 없으신가요?{' '}
            <button
              type="button"
              className="text-foreground underline-offset-4 hover:underline"
              onClick={onOpenSignUp}
            >
              가입신청
            </button>
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SignUpModalDialog({
  open,
  onOpenChange,
  onOpenLogin,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onOpenLogin: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader className="items-center text-center">
          <DialogTitle className="text-xl">가입신청</DialogTitle>
          <DialogDescription>
            신청 후 관리자 승인이 완료되면 로그인할 수 있습니다.
          </DialogDescription>
        </DialogHeader>
        <div className="pt-1">
          {open ? (
            <SignUpApplyForm
              key="signup-modal"
              variant="modal"
              uiVariant={2}
              onRequestLogin={onOpenLogin}
              onClose={() => onOpenChange(false)}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function LoginModalProvider({ children }: { children: React.ReactNode }) {
  const [loginOpen, setLoginOpen] = useState(false);
  const [signUpOpen, setSignUpOpen] = useState(false);
  const [pendingNext, setPendingNext] = useState('');

  const openLogin = useCallback(() => {
    if (typeof window !== 'undefined') {
      const n = new URLSearchParams(window.location.search).get('next');
      if (n && n.startsWith('/')) setPendingNext(n);
      else {
        const here = `${window.location.pathname}${window.location.search}`;
        if (here.startsWith('/')) setPendingNext(here);
      }
    }
    setSignUpOpen(false);
    setLoginOpen(true);
  }, []);

  const openSignUp = useCallback(() => {
    setLoginOpen(false);
    setSignUpOpen(true);
  }, []);

  const onClearNext = useCallback(() => setPendingNext(''), []);

  useEffect(() => {
    const onAuthRequired = () => openLogin();
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  }, [openLogin]);

  return (
    <LoginModalContext.Provider value={{ openLogin, openSignUp }}>
      {children}
      <Suspense fallback={null}>
        <OpenFromUrlEffect
          setLoginOpen={setLoginOpen}
          setSignUpOpen={setSignUpOpen}
          setPendingNext={setPendingNext}
        />
      </Suspense>
      <LoginModalDialog
        open={loginOpen}
        onOpenChange={setLoginOpen}
        pendingNext={pendingNext}
        onClearNext={onClearNext}
        onOpenSignUp={openSignUp}
      />
      <SignUpModalDialog
        open={signUpOpen}
        onOpenChange={setSignUpOpen}
        onOpenLogin={openLogin}
      />
    </LoginModalContext.Provider>
  );
}
