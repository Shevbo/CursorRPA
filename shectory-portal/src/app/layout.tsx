import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shectory — витрина проектов",
  description: "Платформа Shevelev's Factory",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <head>
        {/* If `/_next/static/css/*.css` fails (e.g. nginx mis-proxy), keep a readable dark baseline. */}
        <style
          id="shectory-theme-fallback"
          dangerouslySetInnerHTML={{
            __html:
              ":root{color-scheme:dark}body{margin:0;min-height:100vh;background:#020617;color:#e2e8f0;font-family:ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased}a{color:#60a5fa}a:visited{color:#a78bfa}",
          }}
        />
      </head>
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">{children}</body>
    </html>
  );
}
