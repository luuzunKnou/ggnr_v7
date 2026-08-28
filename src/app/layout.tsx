import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/app/(pages)/(index)/theme-provider";
import { AuthSessionProvider } from "@/app/providers";
import { LoginModalProvider } from "@/app/login-modal-context";
import { ActiveNoticeModal } from "@/app/(pages)/_components/notice/ActiveNoticeModal";
import { ForcedPasswordChangeModal } from "@/app/(pages)/_components/ForcedPasswordChangeModal";
import { BasePathClientPatch } from "@/app/BasePathClientPatch";
import { getBasePath } from "@/lib/basePath";
import { getIndexLogoSrc, getSystemKorName } from "@/service/configService";

export async function generateMetadata(): Promise<Metadata> {
  const icon = getIndexLogoSrc();
  const title = getSystemKorName();
  // Next metadata 가 basePath 를 한 번 더 붙이므로, withBasePath 된 값은 제거해 중복 방지
  const base = getBasePath();
  const iconPath =
    base && icon.startsWith(`${base}/`) ? icon.slice(base.length) : icon;
  return {
    title,
    icons: {
      icon: [{ url: iconPath, type: "image/svg+xml" }],
      apple: iconPath,
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <BasePathClientPatch />
        <AuthSessionProvider>
          <ThemeProvider>
            <LoginModalProvider>
              {children}
              <ActiveNoticeModal />
              <ForcedPasswordChangeModal />
            </LoginModalProvider>
          </ThemeProvider>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
