import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = process.env.NEXT_PUBLIC_SESSION_COOKIE ?? "adcam_session";

const AUTH_PAGES = ["/login", "/signup"];

// Same default as next.config.js, which proxies /api to this origin.
const API_ORIGIN = (process.env.API_ORIGIN || "http://127.0.0.1:8000").replace(/\/+$/, "");

/**
 * Whether this session belongs to an admin. The admin API answers everyone
 * else with a 404, so a customer's request learns nothing. Any failure counts
 * as "no", which sends the visitor to the workspace exactly as before.
 */
async function isAdminSession(session: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(`${API_ORIGIN}/api/v1/admin/settings`, {
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
      cache: "no-store",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Keeps signed-out visitors out of the workspace, and signed-in users off the
 * login and sign-up pages. The landing page at / is public for everyone, and
 * the login page is only ever reached from its buttons: a signed-out visitor
 * who opens /app is sent to the landing page, not to /login.
 *
 * This only checks that a session cookie is present - it deliberately does not
 * verify the signature, because the API is the authority on that and every
 * endpoint re-checks it. The workspace clears a cookie the API rejects, so a
 * stale one cannot bounce a visitor between /login and /app.
 *
 * The one exception is an admin who is already signed in and opens /login:
 * they are sent to the admin panel, not the workspace.
 */
export async function middleware(request: NextRequest) {
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  const hasSession = Boolean(session);
  const { pathname } = request.nextUrl;

  // The admin panel is never advertised: a signed-out visitor gets the normal
  // 404 page rather than a redirect to sign-in that would reveal it exists.
  if (pathname.startsWith("/admin") && !hasSession) {
    return NextResponse.rewrite(new URL("/not-found", request.url));
  }

  if (pathname.startsWith("/app") && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (AUTH_PAGES.includes(pathname) && session) {
    const url = request.nextUrl.clone();
    url.pathname = (await isAdminSession(session)) ? "/admin" : "/app";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/admin/:path*", "/login", "/signup"],
};
