import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = process.env.NEXT_PUBLIC_SESSION_COOKIE ?? "adcam_session";

// Same default as next.config.js, which proxies /api to this origin. Read on
// every request, so the web service needs it at runtime as well as at build.
const API_ORIGIN = (process.env.API_ORIGIN || "http://127.0.0.1:8000").replace(/\/+$/, "");

/**
 * What the API makes of a session cookie:
 * - "admin": the admin API answered 200.
 * - "member": a valid session that is not an admin. The admin API answers
 *   them with a 404, the same as a route that does not exist, so a customer's
 *   request learns nothing.
 * - "expired": the API no longer accepts it (401), for example after a
 *   password change signed it out.
 * - "unknown": the API was slow, down or failed; callers keep the behaviour
 *   from before this check existed.
 */
type Access = "admin" | "member" | "expired" | "unknown";

async function sessionAccess(session: string): Promise<Access> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(`${API_ORIGIN}/api/v1/admin/settings`, {
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
      cache: "no-store",
      signal: controller.signal,
    });
    void response.body?.cancel().catch(() => undefined);
    if (response.ok) return "admin";
    if (response.status === 401) return "expired";
    if (response.status === 403 || response.status === 404) return "member";
    return "unknown";
  } catch {
    return "unknown";
  } finally {
    clearTimeout(timer);
  }
}

/** Drop a session cookie the API has rejected, so the site treats the visitor as signed out. */
function forgetSession(response: NextResponse): NextResponse {
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}

/**
 * Keeps signed-out visitors out of the workspace and the admin panel. The
 * landing page at / is public for everyone, and the login page is only ever
 * reached from its buttons: a signed-out visitor who opens /app is sent to the
 * landing page, not to /login. The login and sign-up pages always show their
 * form, even to someone already signed in (they offer to continue instead),
 * and signing in there sends an admin to the admin panel.
 *
 * For /app this only checks that a session cookie is present - the API is the
 * authority on it and every endpoint re-checks it, and the workspace clears a
 * cookie the API rejects. For /admin it asks the API, and the panel opens only
 * for an admin; everyone else gets the ordinary 404 page, so customers cannot
 * tell it exists. A session the API has ended is cleared there too.
 */
export async function middleware(request: NextRequest) {
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/admin")) {
    const access = session ? await sessionAccess(session) : "expired";
    // When the API cannot answer, the page's own check decides.
    if (access === "admin" || access === "unknown") return NextResponse.next();
    const notFound = NextResponse.rewrite(new URL("/not-found", request.url));
    return session && access === "expired" ? forgetSession(notFound) : notFound;
  }

  if (pathname.startsWith("/app") && !session) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/admin/:path*"],
};
