import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/app/(pages)/(index)/theme-provider";
import { AuthSessionProvider } from "@/app/providers";
import { LoginModalProvider } from "@/app/login-modal-context";
import { ActiveNoticeModal } from "@/app/(pages)/_components/notice/ActiveNoticeModal";
import { ForcedPasswordChangeModal } from "@/app/(pages)/_components/ForcedPasswordChangeModal";
import { BasePathClientPatch } from "@/app/BasePathClientPatch";

/**
 * `/favicon.ico` 만 지정 — Next 가 basePath(/build_yy)를 자동 접두.
 * (`/build_yy/favicon.ico` 를 직접 쓰면 이중 접두 위험)
 */
export const metadata: Metadata = {
  icons: {
    icon: [{ url: "/favicon.ico" }],
  },
};

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
