import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shectory — витрина проектов",
  description: "Платформа Shevelev's Factory",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
