import { NextResponse, type NextRequest } from "next/server";

const AUTH_COOKIE = "ecom_admin";

/**
 * Cheap gate: bounce visitors without a session cookie to the login page.
 * Real authorization is enforced by the API on every admin request.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === "/admin/login" || request.cookies.has(AUTH_COOKIE)) return NextResponse.next();

  const url = new URL("/admin/login", request.url);
  url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/admin", "/admin/:path*"] };
