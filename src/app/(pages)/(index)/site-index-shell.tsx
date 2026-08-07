import Link from 'next/link';
import Image from 'next/image';
import { BizNotifPrefetch } from '@/app/(pages)/(index)/BizNotifPrefetch';
import { DevModeFooterTrigger } from '@/app/(pages)/(index)/dev-mode-footer-trigger';
import { ThemeToggle } from '@/app/(pages)/(index)/theme-toggle';
import { HeaderAuthLinks } from '@/app/(pages)/(index)/header-auth-links';
import { getIndexLogoSrc, getIndexFooterConfig, getSystemKorName } from '@/service/configService';

type SiteIndexShellProps = {
  children: React.ReactNode;
  mainClassName?: string;
};

export function SiteIndexShell({ children, mainClassName }: SiteIndexShellProps) {
  const projectName = typeof process !== 'undefined' ? (process.env.GGNR_PROJECT ?? 'build_yy') : 'build_yy';
  const indexLogoSrc = getIndexLogoSrc(projectName);
  const siteTitle = getSystemKorName();
  const { footerAddr, footerRss } = getIndexFooterConfig();

  return (
    <div className="min-h-screen bg-background pb-[20px]">
      <BizNotifPrefetch />
      <header className="border-b bg-card shrink-0">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
            <Image
              src={indexLogoSrc}
              alt={siteTitle}
              width={100}
              height={38}
              className="h-9 w-auto max-w-[100px] max-h-[30px] object-contain object-left"
              priority
            />
            <h1 className="text-xl font-bold text-foreground">{siteTitle}</h1>
          </Link>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              href="/sysManager"
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors rounded-[5px]"
            >
              <svg className="w-4.5 h-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span className="text-[13px]">시스템 관리</span>
            </Link>
            <HeaderAuthLinks />
          </div>
        </div>
      </header>

      <main
        className={
          mainClassName ??
          'container mx-auto px-4 py-8 pb-24'
        }
      >
        {children}
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-10 max-h-[110px]">
        <DevModeFooterTrigger>
          <div className="container mx-auto text-center text-sm">
            <p className="-mt-[11px]">{footerAddr}</p>
            <p className="py-1 text-slate-400">{footerRss}</p>
          </div>
        </DevModeFooterTrigger>
      </div>
    </div>
  );
}
