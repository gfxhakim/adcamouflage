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

  // One address for Google: www.<site> -> <site> (or the other way round),
  // only when SITE_URL is set on the web service.
  const canonical = canonicalRedirect(request);
  if (canonical) return canonical;

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

/**
 * Sends a visitor on the other spelling of the site host (www or bare) to the
 * SITE_URL one with a permanent redirect. Only GET/HEAD page loads: API calls
 * and payment notifications are never redirected.
 */
function canonicalRedirect(request: NextRequest): NextResponse | null {
  const site = (process.env.SITE_URL || "").trim();
  if (!site || !["GET", "HEAD"].includes(request.method)) return null;
  let target: URL;
  try {
    target = new URL(site);
  } catch {
    return null;
  }
  const host = (request.headers.get("x-forwarded-host") || request.headers.get("host") || "").split(":")[0].toLowerCase();
  const want = target.hostname.toLowerCase();
  const twin = want.startsWith("www.") ? want.slice(4) : `www.${want}`;
  if (host !== twin) return null;
  const url = new URL(request.nextUrl.pathname + request.nextUrl.search, target.origin);
  return NextResponse.redirect(url, 308);
}

export const config = {
  // Every page (for the www redirect); not the API, Next's files or static assets.
  matcher: ["/((?!api/|_next/|brand/|landing/|favicon.ico|icon.png|apple-icon.png).*)"],
};
