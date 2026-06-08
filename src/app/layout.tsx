import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/app/(pages)/(index)/theme-provider";
import { AuthSessionProvider } from "@/app/providers";
import { LoginModalProvider } from "@/app/login-modal-context";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <AuthSessionProvider>
          <ThemeProvider>
            <LoginModalProvider>{children}</LoginModalProvider>
          </ThemeProvider>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
