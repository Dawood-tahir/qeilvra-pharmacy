import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, getPublicSupabaseEnv } from "@/lib/env";

export async function updateSession(request: NextRequest) {
  if (!isSupabaseConfigured) {
    const path = request.nextUrl.pathname;
    const publicPath = path.startsWith("/login") || path.startsWith("/forgot-password") || path.startsWith("/auth/") || path.startsWith("/_next") || path === "/favicon.ico";
    if (!publicPath) {
      if (path.startsWith("/api/")) return NextResponse.json({ error: "Your session expired. Sign in again." }, { status: 401 });
      const urlTo = request.nextUrl.clone();
      urlTo.pathname = "/login";
      urlTo.searchParams.set("next", path);
      return NextResponse.redirect(urlTo);
    }
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const { url, publishableKey } = getPublicSupabaseEnv();
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Verified JWTs use the SDK's public-key cache when asymmetric signing is enabled.
  // Each protected action/page still checks the user and current database permissions.
  const { data, error } = await supabase.auth.getClaims();
  const user = !error && data?.claims.sub;
  const finish = (next: NextResponse) => {
    response.cookies.getAll().forEach(cookie => next.cookies.set(cookie));
    next.headers.set("Cache-Control", "private, no-store");
    return next;
  };
  response.headers.set("Cache-Control", "private, no-store");
  const path = request.nextUrl.pathname;
  const isAuthPath = path.startsWith("/login") || path.startsWith("/forgot-password") || path.startsWith("/auth/");

  if (!user && !isAuthPath && !path.startsWith("/_next") && path !== "/favicon.ico") {
    if (path.startsWith("/api/")) return finish(NextResponse.json({ error: "Your session expired. Sign in again." }, { status: 401 }));
    const urlTo = request.nextUrl.clone();
    urlTo.pathname = "/login";
    urlTo.searchParams.set("next", path);
    return finish(NextResponse.redirect(urlTo));
  }
  // An inactive profile can still have a valid Auth token. Let its sign-in error
  // render instead of bouncing forever between Dashboard and Login.
  if (user && path === "/login" && request.nextUrl.searchParams.get("error") !== "inactive") {
    const urlTo = request.nextUrl.clone();
    urlTo.pathname = "/dashboard";
    urlTo.search = "";
    return finish(NextResponse.redirect(urlTo));
  }
  return response;
}
