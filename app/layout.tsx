import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { NotificationListener } from "@/components/NotificationListener"; // <--- ИМПОРТ

export const metadata: Metadata = {
  title: "Playerlink",
  description: "Social Platform",
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
          <NotificationListener /> {/* <--- ВСТАВИТЬ СЮДА */}
          {children}
        </Providers>
      </body>
    </html>
  );
}