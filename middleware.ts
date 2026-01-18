import { NextRequest, NextResponse } from "next/server";

const fallbackAppUrl = "https://uni-leads.netlify.app";
const appUrl = process.env.NEXT_PUBLIC_APP_URL || fallbackAppUrl;
const appHost = new URL(appUrl).host.toLowerCase();
const appOrigin = new URL(appUrl).origin;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const normalizeHost = (host: string) =>
  host.toLowerCase().replace(/:\d+$/, "");

const stripWww = (host: string) => host.replace(/^www\./, "");

const isAppHost = (host: string) => {
  if (!appHost) {
    return host.includes("localhost") || host.startsWith("127.0.0.1");
  }
  return stripWww(host) === stripWww(appHost);
};

const shouldSkip = (pathname: string) =>
  pathname.startsWith("/_next") ||
  pathname.startsWith("/api") ||
  pathname === "/favicon.ico";

const resolveTenantDomain = async (host: string) => {
  if (!supabaseUrl || !supabaseAnonKey) return null;
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/resolve_tenant_domain`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ p_domain: host })
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as Array<{
    tenant_id?: string;
    slug?: string | null;
  }>;

  if (!Array.isArray(data) || data.length === 0) return null;
  const row = data[0];
  if (!row?.tenant_id) return null;
  return {
    tenantId: row.tenant_id,
    slug: row.slug ?? null
  };
};

export async function middleware(request: NextRequest) {
  const hostHeader = request.headers.get("host") ?? "";
  const host = normalizeHost(hostHeader);

  if (!host || isAppHost(host) || shouldSkip(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const tenant = await resolveTenantDomain(host);
  if (!tenant) {
    return NextResponse.next();
  }

  const pathname = request.nextUrl.pathname;
  const search = request.nextUrl.search;

  if (pathname.startsWith("/super")) {
    if (appOrigin) {
      const url = new URL(pathname, appOrigin);
      url.search = search;
      return NextResponse.redirect(url, 307);
    }
    return NextResponse.next();
  }

  const adminSegment = "/admin";
  const adminIndex = pathname.indexOf(adminSegment);
  const isAdminPath =
    pathname === adminSegment ||
    pathname.startsWith(`${adminSegment}/`) ||
    (pathname.startsWith("/t/") && adminIndex >= 0);

  if (isAdminPath) {
    if (appOrigin && tenant.slug) {
      const suffix =
        adminIndex >= 0
          ? pathname.slice(adminIndex + adminSegment.length)
          : "";
      const url = new URL(`/t/${tenant.slug}/admin${suffix}`, appOrigin);
      url.search = search;
      return NextResponse.redirect(url, 307);
    }
    return NextResponse.next();
  }

  if (pathname === "/" && tenant.slug) {
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = `/t/${tenant.slug}`;
    return NextResponse.rewrite(rewriteUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/:path*"]
};
