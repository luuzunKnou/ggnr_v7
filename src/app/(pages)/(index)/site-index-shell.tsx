import Link from 'next/link';
import Image from 'next/image';
import { BizNotifPrefetch } from '@/app/(pages)/(index)/BizNotifPrefetch';
import { DevModeFooterTrigger } from '@/app/(pages)/(index)/dev-mode-footer-trigger';
import { ThemeToggle } from '@/app/(pages)/(index)/theme-toggle';
import { HeaderAuthLinks } from '@/app/(pages)/(index)/header-auth-links';
import { SysManagerNavLink } from '@/app/(pages)/(index)/SysManagerNavLink';
import { getIndexLogoSrc, getIndexFooterConfig, getSystemKorName } from '@/service/configService';
import { cn } from '@/lib/utils';

type SiteIndexShellProps = {
  children: React.ReactNode;
  mainClassName?: string;
  /** 공지·자료실 등 — 헤더 아래 main이 남은 뷰포트 높이를 채움 */
  fillViewport?: boolean;
};

export function SiteIndexShell({ children, mainClassName, fillViewport = false }: SiteIndexShellProps) {
  const projectName = typeof process !== 'undefined' ? (process.env.GGNR_PROJECT ?? 'build_yy') : 'build_yy';
  const indexLogoSrc = getIndexLogoSrc(projectName);
  const siteTitle = getSystemKorName();
  const { footerAddr, footerRss } = getIndexFooterConfig();

  return (
    <div
      className={cn(
        'min-h-screen bg-background pb-[20px]',
        fillViewport && 'flex flex-col'
      )}
    >
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
            <SysManagerNavLink />
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
