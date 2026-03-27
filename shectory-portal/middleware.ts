import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const p = req.nextUrl.pathname;

  // Prevent browser/proxy cache for protected portal surfaces and auth endpoints.
  if (p.startsWith("/projects") || p.startsWith("/api/")) {
    res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
    res.headers.set("Pragma", "no-cache");
    res.headers.set("Expires", "0");
    res.headers.set("Surrogate-Control", "no-store");
  }
  return res;
}

export const config = {
  matcher: ["/projects/:path*", "/api/:path*"],
};

