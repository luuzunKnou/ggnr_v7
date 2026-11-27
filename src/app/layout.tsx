import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/app/(pages)/(index)/theme-provider";
import { AuthSessionProvider } from "@/app/providers";
import { LoginModalProvider } from "@/app/login-modal-context";
import { ActiveNoticeModal } from "@/app/(pages)/_components/notice/ActiveNoticeModal";
import { ForcedPasswordChangeModal } from "@/app/(pages)/_components/ForcedPasswordChangeModal";
import { SecurityPledgeAttachmentHost } from "@/app/(pages)/_components/securityPledge/SecurityPledgeAttachmentHost";
import { SecurityPledgeExcelHost } from "@/app/(pages)/_components/securityPledge/SecurityPledgeExcelHost";
import { BasePathClientPatch } from "@/app/BasePathClientPatch";
import { OdorPhScadaChromeSync } from "@/app/(pages)/(index)/odorPhV2/OdorPhScadaChromeSync";
import { withBasePath } from "@/lib/basePath";
import { getIndexLogoSrc, getSystemKorName } from "@/service/configService";

export async function generateMetadata(): Promise<Metadata> {
  const icon = withBasePath(getIndexLogoSrc());
  const title = getSystemKorName();
  return {
    title,
    icons: {
      icon: [{ url: icon, type: "image/svg+xml" }],
      apple: icon,
    },
    /** 크롬·구글 자동번역이 DOM을 바꿔 React 예외가 나는 것 방지 */
    other: {
      google: "notranslate",
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const projectName = (process.env.GGNR_PROJECT ?? "").trim();
  const darkClassName = projectName === "odor_ph" ? "dark_v2" : "dark";

  return (
    <html lang="ko" translate="no" className="notranslate" suppressHydrationWarning>
      <head>
        {/* 첫 페인트 전 localStorage 테마 적용 — useEffect 지연으로 라이트→다크 깜빡임 방지 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("theme");var dark=${JSON.stringify(darkClassName)};var r=t==="light"?"light":t==="dark"?"dark":(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");var el=document.documentElement;el.classList.remove("light","dark","dark_v2");el.classList.add(r==="dark"?dark:"light");}catch(e){}})();`,
          }}
        />
      </head>
      <body className="font-sans antialiased notranslate" translate="no" suppressHydrationWarning>
        <BasePathClientPatch />
        <AuthSessionProvider>
          <ThemeProvider darkClassName={darkClassName}>
            <OdorPhScadaChromeSync projectName={projectName} />
            <LoginModalProvider>
              {children}
              <ActiveNoticeModal />
              <ForcedPasswordChangeModal />
              <SecurityPledgeAttachmentHost />
              <SecurityPledgeExcelHost />
            </LoginModalProvider>
          </ThemeProvider>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
