import { NextResponse, type NextRequest } from "next/server";

/**
 * The browser only ever calls `/api/*` on this app's own origin; this proxy
 * forwards those requests to the ServiceBridge API.
 *
 * `API_INTERNAL_URL` is read on every request (Proxy runs on the Node.js
 * runtime), so one build can be deployed for any install. Same-origin calls
 * also let the auth cookie be SameSite=Strict (session 3).
 */
export function proxy(request: NextRequest) {
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

  const { pathname, search } = request.nextUrl;
  return NextResponse.rewrite(new URL(`${pathname}${search}`, upstream));
}

export const config = {
  matcher: "/api/:path*",
};
