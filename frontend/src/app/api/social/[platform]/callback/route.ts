import crypto from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { isSocialPlatform } from "@/lib/social/platforms";
import { appBaseUrl, getCredentials, redirectUri } from "@/lib/social/config";
import { exchangeCode, SocialApiError } from "@/lib/social/oauth";
import { saveAccount } from "@/lib/social/accounts";
import { OAUTH_STATE_COOKIE } from "@/lib/social/state";

function sameState(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// Step 2 of linking an account: the platform sends the user back here with
// a one-time code, which is swapped for tokens and stored. Always ends in a
// redirect to /account, which shows the outcome (see ConnectedAccounts.tsx).
export async function GET(req: Request, { params }: { params: { platform: string } }) {
  const { platform } = params;
  if (!isSocialPlatform(platform)) {
    return NextResponse.json({ error: "unknown_platform" }, { status: 404 });
  }

  const base = appBaseUrl(req);
  const finish = (query: string) => {
    const res = NextResponse.redirect(`${base}/account?${query}&platform=${platform}`);
    res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/api/social", maxAge: 0 });
    return res;
  };

  const session = await getSession();
  if (!session) {
    return NextResponse.redirect(`${base}/login`);
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const expected = cookies().get(OAUTH_STATE_COOKIE)?.value ?? "";

  if (!expected || !sameState(expected, `${platform}.${state}`)) {
    return finish("social_error=state_mismatch");
  }
  // The user pressed "cancel" on the consent screen (or the platform refused).
  if (url.searchParams.get("error") || !code) {
    return finish("social_error=denied");
  }

  const creds = getCredentials(platform);
  if (!creds) {
    return finish("social_error=not_configured");
  }

  try {
    const identity = await exchangeCode(platform, creds, redirectUri(req, platform), code);
    await saveAccount(session.id, platform, identity);
    return finish("social_connected=1");
  } catch (err) {
    console.error(`[social/${platform}/callback] Failed to link account:`, err);
    const errorCode = err instanceof SocialApiError ? err.code : "connect_failed";
    return finish(`social_error=${encodeURIComponent(errorCode)}`);
  }
}
