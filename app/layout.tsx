import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { NotificationListener } from "@/components/NotificationListener";
import OneSignalInit from '@/components/OneSignalInit';
import OnlineHeartbeat from '@/components/OnlineHeartbeat';
import { Toaster } from 'sonner';

export const metadata: Metadata = {
  title: "Playerlink",
  description: "Social Platform",
  manifest: "/manifest.json", // <--- Добавили ссылку
  themeColor: "#0b0e14",      // <--- Цвет "шапки" браузера на мобильном
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Playerlink",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body>
        <Providers>
          <NotificationListener />
          <OneSignalInit />
          <OnlineHeartbeat />
          {children}
          <Toaster position="top-center" richColors />
        </Providers>
      </body>
    </html>
  );
}