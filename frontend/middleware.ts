import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = process.env.NEXT_PUBLIC_SESSION_COOKIE ?? "adcam_session";

const AUTH_PAGES = ["/login", "/signup"];

/**
 * Keeps signed-out visitors out of the workspace, and signed-in users off the
 * login and sign-up pages. The landing page at / is public for everyone.
 *
 * This only checks that a session cookie is present - it deliberately does not
 * verify the signature, because the API is the authority on that and every
 * endpoint re-checks it. The workspace clears a cookie the API rejects, so a
 * stale one cannot bounce a visitor between /login and /app.
 */
export function middleware(request: NextRequest) {
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  const { pathname, search } = request.nextUrl;

  // The admin panel is never advertised: a signed-out visitor gets the normal
  // 404 page rather than a redirect to sign-in that would reveal it exists.
  if (pathname.startsWith("/admin") && !hasSession) {
    return NextResponse.rewrite(new URL("/not-found", request.url));
  }

  if (pathname.startsWith("/app") && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  if (AUTH_PAGES.includes(pathname) && hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/app";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/admin/:path*", "/login", "/signup"],
};
