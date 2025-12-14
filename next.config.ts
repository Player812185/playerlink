import type { NextConfig } from "next";

const withPWA = require("@ducanh2912/next-pwa").default({
  dest: "public", // Куда класть service worker
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  swcMinify: true,
  disable: process.env.NODE_ENV === "development", // Отключаем PWA на локалке (чтобы не кэшировало ошибки)
  workboxOptions: {
    disableDevLogs: true,
  },
});

const nextConfig: NextConfig = {
  // Разрешаем загрузку картинок с домена Supabase
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'jmleajclbgbacdzznpds.supabase.co', // Подставь свой точный домен, если знаешь, или оставь маску
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY', // Запрет встраивания в iframe
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ];
  },
};

export default withPWA(nextConfig);