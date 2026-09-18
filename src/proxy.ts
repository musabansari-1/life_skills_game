/**
 * Optimistic auth gate: redirect to the landing page when no session cookie is
 * present. Real session validation happens in server components / routes.
 */
import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "lsg_session";
const PROTECTED = ["/world", "/quests", "/play", "/results", "/characters", "/onboarding"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const hasSession = !!request.cookies.get(SESSION_COOKIE)?.value;
  if (isProtected && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (pathname === "/" && hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/world";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/world/:path*", "/quests/:path*", "/play/:path*", "/results/:path*", "/characters/:path*", "/onboarding"],
};
