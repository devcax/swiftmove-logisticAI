import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export async function middleware(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const authenticated = token
    ? await verifySessionToken(token).catch(() => false)
    : false;
  const isLoginRoute =
    request.nextUrl.pathname === "/login" ||
    request.nextUrl.pathname.startsWith("/login/");

  if (!authenticated && !isLoginRoute) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (authenticated && isLoginRoute) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
