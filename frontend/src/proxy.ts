import { NextResponse, type NextRequest } from "next/server";

/** Set by the API at sign-in. Not a credential: only says a sign-in exists. */
export const SIGNED_IN_COOKIE = "sb_signed_in";

/** Set by the portal API at magic-link sign-in. Not a credential: only says a sign-in exists. */
export const PORTAL_SIGNED_IN_COOKIE = "sb_portal_signed_in";

const PUBLIC_PAGES = [
  /^\/login$/,
  /^\/welcome\/[^/]+$/,
  /^\/reset-password\/[^/]+$/,
  /^\/feedback\/[^/]+$/,
];

const PORTAL_PUBLIC_PAGES = [/^\/portal\/login$/, /^\/portal\/auth\/verify$/];

export function isPublicPage(pathname: string): boolean {
  return PUBLIC_PAGES.some((pattern) => pattern.test(pathname));
}

export function isPortalPublicPage(pathname: string): boolean {
  return PORTAL_PUBLIC_PAGES.some((pattern) => pattern.test(pathname));
}

function isPortalPage(pathname: string): boolean {
  return pathname === "/portal" || pathname.startsWith("/portal/");
}

/**
 * 1. `/api/*` is forwarded to the ERPTick API. `API_INTERNAL_URL` is read
 *    on every request (Proxy runs on the Node.js runtime), so one build can be
 *    deployed for any install, and same-origin calls let auth cookies be
 *    SameSite=Strict.
 * 2. Pages: an optimistic sign-in check (cookie presence only, as the Next.js
 *    auth guide recommends). The API still verifies the session on every call.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    const upstream = process.env.API_INTERNAL_URL;
    if (!upstream) {
      return NextResponse.json(
        {
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "The API address is not configured. Set API_INTERNAL_URL.",
          },
        },
        { status: 503 },
      );
    }
    return NextResponse.rewrite(new URL(`${pathname}${search}`, upstream));
  }

  const signedIn = request.cookies.has(SIGNED_IN_COOKIE);

  // The customer portal is a separate sign-in (magic link). Its login and
  // verify pages stay public; every other /portal/* page needs the portal
  // cookie, checked optimistically — the API verifies the session on each call.
  if (isPortalPage(pathname)) {
    const portalSignedIn = request.cookies.has(PORTAL_SIGNED_IN_COOKIE);
    if (!portalSignedIn && !isPortalPublicPage(pathname)) {
      const login = new URL("/portal/login", request.url);
      login.searchParams.set("next", `${pathname}${search}`);
      return NextResponse.redirect(login);
    }
    return NextResponse.next();
  }

  if (!signedIn && !isPublicPage(pathname)) {
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  // Everything except Next's own assets and files with an extension (favicon, images).
  matcher: ["/api/:path*", "/((?!_next/|.*\\.[a-zA-Z0-9]+$).*)"],
};
