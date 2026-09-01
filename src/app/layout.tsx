import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/app/(pages)/(index)/theme-provider";
import { AuthSessionProvider } from "@/app/providers";
import { LoginModalProvider } from "@/app/login-modal-context";
import { ActiveNoticeModal } from "@/app/(pages)/_components/notice/ActiveNoticeModal";
import { ForcedPasswordChangeModal } from "@/app/(pages)/_components/ForcedPasswordChangeModal";
import { BasePathClientPatch } from "@/app/BasePathClientPatch";
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
