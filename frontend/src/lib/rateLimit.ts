import { NextResponse } from "next/server";

// Minimal in-memory fixed-window limiter -- enough for a single Next.js
// process (this app runs exactly one). Would need a shared store (e.g.
// Redis) if the frontend were ever scaled to several instances.
const buckets = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: Request): string {
  // Set by the reverse proxy in front of the app (nginx/Caddy/Cloudflare).
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

// Returns a 429 response when `name` has been hit more than `limit` times
// from this client within `windowMs`, otherwise null.
export function rateLimit(req: Request, name: string, limit: number, windowMs: number): NextResponse | null {
  const now = Date.now();
  const key = `${name}:${clientIp(req)}`;
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
  } else if (++bucket.count > limit) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  // Opportunistic sweep so the map can't grow without bound.
  if (buckets.size > 10_000) {
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(k);
    }
  }
  return null;
}
