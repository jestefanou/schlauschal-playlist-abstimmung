// Origin für Redirects/Callback-URLs, bevorzugt aus NEXT_PUBLIC_SITE_URL
// (proxy-/host-robust), sonst aus dem Host-Header. request.url nur als letzter
// Fallback — der ist im Next-Dev nicht zuverlässig der tatsächliche Host
// (z. B. immer localhost). Gleiche Logik wie im Auth-Callback/-Action.
export function siteOrigin(request: Request): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");

  const host = request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? "http";
    return `${proto}://${host}`;
  }
  return new URL(request.url).origin;
}
