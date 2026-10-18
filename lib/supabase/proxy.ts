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

  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isAuthPath = path.startsWith("/login") || path.startsWith("/forgot-password") || path.startsWith("/auth/");

  if (!user && !isAuthPath && !path.startsWith("/_next") && path !== "/favicon.ico") {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Your session expired. Sign in again." }, { status: 401 });
    const urlTo = request.nextUrl.clone();
    urlTo.pathname = "/login";
    urlTo.searchParams.set("next", path);
    return NextResponse.redirect(urlTo);
  }
  if (user && path === "/login") {
    const urlTo = request.nextUrl.clone();
    urlTo.pathname = "/dashboard";
    urlTo.search = "";
    return NextResponse.redirect(urlTo);
  }
  return response;
}
