import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = process.env.NEXT_PUBLIC_SESSION_COOKIE ?? "adcam_session";

/**
 * Keeps signed-out visitors out of the console.
 *
 * This only checks that a session cookie is present - it deliberately does not
 * verify the signature, because the API is the authority on that and every
 * endpoint re-checks it. The purpose here is to send visitors to the landing
 * page instead of showing them an app that would fail every request.
 */
export function middleware(request: NextRequest) {
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith("/app") && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  // Someone already signed in has no use for the landing page's sign-in form.
  if (pathname === "/" && hasSession && request.nextUrl.searchParams.get("stay") !== "1") {
    const url = request.nextUrl.clone();
    url.pathname = "/app";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/app/:path*"],
};
