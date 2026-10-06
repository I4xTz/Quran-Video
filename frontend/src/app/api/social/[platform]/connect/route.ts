import crypto from "crypto";
import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rateLimit";
import { getSession } from "@/lib/auth/session";
import { isSocialPlatform } from "@/lib/social/platforms";
import { appBaseUrl, getCredentials, redirectUri } from "@/lib/social/config";
import { buildAuthorizeUrl } from "@/lib/social/oauth";
import { OAUTH_STATE_COOKIE, oauthStateCookieOptions } from "@/lib/social/state";

// Step 1 of linking an account: a plain top-level navigation here (it's an
// <a href>, not a fetch) sends the browser on to the platform's consent
// screen, which then returns to ../callback.
export async function GET(req: Request, { params }: { params: { platform: string } }) {
  const limited = rateLimit(req, "social-connect", 20, 10 * 60 * 1000);
  if (limited) return limited;

  const { platform } = params;
  if (!isSocialPlatform(platform)) {
    return NextResponse.json({ error: "unknown_platform" }, { status: 404 });
  }

  const base = appBaseUrl(req);
  const session = await getSession();
  if (!session) {
    return NextResponse.redirect(`${base}/login`);
  }

  // The session and state cookies belong to the host the user is browsing
  // on; the platform will send them back to APP_URL. If those differ (e.g.
  // browsing on localhost while APP_URL is an https tunnel) the callback
  // could never see either cookie -- move them onto the right host first.
  if (new URL(base).host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) {
    return NextResponse.redirect(`${base}/account`);
  }

  const creds = getCredentials(platform);
  if (!creds) {
    return NextResponse.redirect(`${base}/account?social_error=not_configured&platform=${platform}`);
  }

  const state = crypto.randomBytes(24).toString("hex");
  const res = NextResponse.redirect(buildAuthorizeUrl(platform, creds, redirectUri(req, platform), state));
  res.cookies.set(OAUTH_STATE_COOKIE, `${platform}.${state}`, oauthStateCookieOptions());
  return res;
}
