import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers"; // Импортируем наш провайдер
import { SpeedInsights } from "@vercel/speed-insights/next";

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
          {children}
        </Providers>
        <SpeedInsights />
      </body>
    </html>
  );
}