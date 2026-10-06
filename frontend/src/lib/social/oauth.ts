import type { SocialPlatform } from "./platforms";
import { tiktokPostMode, type PlatformCredentials } from "./config";

// Graph API version for every Instagram call (oauth + publishing).
export const INSTAGRAM_GRAPH = "https://graph.instagram.com/v24.0";

// `code` is a short machine-readable slug the routes hand to the UI (which
// owns the translated wording); `message` is the platform's own text, only
// ever logged / shown as a secondary detail.
export class SocialApiError extends Error {
  constructor(
    public code: string,
    message?: string
  ) {
    super(message ?? code);
  }
}

export type TokenSet = {
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  scopes: string;
};

export type LinkedIdentity = TokenSet & { externalId: string; displayName: string };

function expiryFrom(seconds: unknown): Date | null {
  return typeof seconds === "number" && seconds > 0 ? new Date(Date.now() + seconds * 1000) : null;
}

// Every platform call goes through here: `cache: "no-store"` keeps Next's
// patched fetch from ever trying to cache (or even read) a request body.
export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, cache: "no-store" });
}

export async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

function formBody(params: Record<string, string>) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  };
}

function describeError(data: any): string {
  const err = data?.error;
  if (typeof err === "string") return data.error_description ?? data.error_message ?? err;
  return err?.message ?? data?.error_message ?? data?.raw ?? "unknown error";
}

const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  // Only used to show which channel is linked.
  "https://www.googleapis.com/auth/youtube.readonly",
];

function tiktokScopes(): string[] {
  return ["user.info.basic", tiktokPostMode() === "inbox" ? "video.upload" : "video.publish"];
}

const INSTAGRAM_SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];

export function buildAuthorizeUrl(
  platform: SocialPlatform,
  creds: PlatformCredentials,
  redirect: string,
  state: string
): string {
  if (platform === "youtube") {
    const params = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: redirect,
      response_type: "code",
      scope: YOUTUBE_SCOPES.join(" "),
      // offline + consent: Google only returns a refresh token on a consent
      // screen, and without one the link would die after an hour.
      access_type: "offline",
      prompt: "consent",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }
  if (platform === "tiktok") {
    const params = new URLSearchParams({
      client_key: creds.clientId,
      redirect_uri: redirect,
      response_type: "code",
      scope: tiktokScopes().join(","),
      state,
    });
    return `https://www.tiktok.com/v2/auth/authorize/?${params}`;
  }
  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope: INSTAGRAM_SCOPES.join(","),
    state,
  });
  return `https://www.instagram.com/oauth/authorize?${params}`;
}

async function exchangeYouTube(creds: PlatformCredentials, redirect: string, code: string): Promise<LinkedIdentity> {
  const res = await apiFetch(
    "https://oauth2.googleapis.com/token",
    formBody({
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: redirect,
      grant_type: "authorization_code",
    })
  );
  const data = await readJson(res);
  if (!res.ok || !data.access_token) {
    throw new SocialApiError("token_exchange_failed", describeError(data));
  }
  // Google lets the user untick individual permissions on the consent screen.
  const scopes: string = data.scope ?? "";
  if (!scopes.includes("youtube.upload")) {
    throw new SocialApiError("missing_scope");
  }

  const channelRes = await apiFetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
    headers: { Authorization: `Bearer ${data.access_token}` },
  });
  const channelData = await readJson(channelRes);
  const channel = channelData.items?.[0];
  if (!channelRes.ok) {
    throw new SocialApiError("profile_failed", describeError(channelData));
  }
  if (!channel) {
    // A Google account that never created a YouTube channel can't upload.
    throw new SocialApiError("no_channel");
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    accessTokenExpiresAt: expiryFrom(data.expires_in),
    refreshTokenExpiresAt: null,
    scopes,
    externalId: channel.id,
    displayName: channel.snippet?.title ?? channel.id,
  };
}

async function exchangeTikTok(creds: PlatformCredentials, redirect: string, code: string): Promise<LinkedIdentity> {
  const res = await apiFetch(
    "https://open.tiktokapis.com/v2/oauth/token/",
    formBody({
      client_key: creds.clientId,
      client_secret: creds.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirect,
    })
  );
  const data = await readJson(res);
  if (!res.ok || !data.access_token) {
    throw new SocialApiError("token_exchange_failed", describeError(data));
  }
  const scopes: string = data.scope ?? "";
  const needed = tiktokScopes()[1];
  if (!scopes.split(",").includes(needed)) {
    throw new SocialApiError("missing_scope");
  }

  // Best-effort: the link still works without a display name.
  let displayName: string = data.open_id;
  try {
    const userRes = await apiFetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name", {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    const userData = await readJson(userRes);
    displayName = userData.data?.user?.display_name || displayName;
  } catch {}

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    accessTokenExpiresAt: expiryFrom(data.expires_in),
    refreshTokenExpiresAt: expiryFrom(data.refresh_expires_in),
    scopes,
    externalId: data.open_id,
    displayName,
  };
}

async function exchangeInstagram(creds: PlatformCredentials, redirect: string, code: string): Promise<LinkedIdentity> {
  const res = await apiFetch(
    "https://api.instagram.com/oauth/access_token",
    formBody({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: "authorization_code",
      redirect_uri: redirect,
      code,
    })
  );
  const raw = await readJson(res);
  // Returned either flat or wrapped in { data: [ ... ] } depending on version.
  const short = raw.data?.[0] ?? raw;
  if (!res.ok || !short.access_token) {
    throw new SocialApiError("token_exchange_failed", describeError(raw));
  }
  const permissions: string = Array.isArray(short.permissions) ? short.permissions.join(",") : (short.permissions ?? "");
  if (permissions && !permissions.includes("instagram_business_content_publish")) {
    throw new SocialApiError("missing_scope");
  }

  // The code only buys a 1-hour token; swap it for the 60-day one.
  const longParams = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: creds.clientSecret,
    access_token: short.access_token,
  });
  const longRes = await apiFetch(`https://graph.instagram.com/access_token?${longParams}`);
  const long = await readJson(longRes);
  if (!longRes.ok || !long.access_token) {
    throw new SocialApiError("token_exchange_failed", describeError(long));
  }

  const meRes = await apiFetch(
    `${INSTAGRAM_GRAPH}/me?fields=user_id,username&access_token=${encodeURIComponent(long.access_token)}`
  );
  const me = await readJson(meRes);
  if (!meRes.ok || !(me.user_id ?? me.id)) {
    throw new SocialApiError("profile_failed", describeError(me));
  }

  return {
    accessToken: long.access_token,
    refreshToken: null,
    accessTokenExpiresAt: expiryFrom(long.expires_in),
    refreshTokenExpiresAt: null,
    scopes: permissions,
    externalId: String(me.user_id ?? me.id),
    displayName: me.username ? `@${me.username}` : String(me.user_id ?? me.id),
  };
}

export function exchangeCode(
  platform: SocialPlatform,
  creds: PlatformCredentials,
  redirect: string,
  code: string
): Promise<LinkedIdentity> {
  if (platform === "youtube") return exchangeYouTube(creds, redirect, code);
  if (platform === "tiktok") return exchangeTikTok(creds, redirect, code);
  return exchangeInstagram(creds, redirect, code);
}

// Trades the stored credentials for a fresh access token. Instagram has no
// refresh token -- its long-lived access token is itself what gets renewed.
export async function refreshTokens(
  platform: SocialPlatform,
  creds: PlatformCredentials,
  current: { accessToken: string; refreshToken: string | null }
): Promise<Omit<TokenSet, "scopes">> {
  if (platform === "instagram") {
    const params = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: current.accessToken });
    const res = await apiFetch(`https://graph.instagram.com/refresh_access_token?${params}`);
    const data = await readJson(res);
    if (!res.ok || !data.access_token) {
      throw new SocialApiError("reconnect_required", describeError(data));
    }
    return {
      accessToken: data.access_token,
      refreshToken: null,
      accessTokenExpiresAt: expiryFrom(data.expires_in),
      refreshTokenExpiresAt: null,
    };
  }

  if (!current.refreshToken) {
    throw new SocialApiError("reconnect_required");
  }
  const res =
    platform === "youtube"
      ? await apiFetch(
          "https://oauth2.googleapis.com/token",
          formBody({
            client_id: creds.clientId,
            client_secret: creds.clientSecret,
            refresh_token: current.refreshToken,
            grant_type: "refresh_token",
          })
        )
      : await apiFetch(
          "https://open.tiktokapis.com/v2/oauth/token/",
          formBody({
            client_key: creds.clientId,
            client_secret: creds.clientSecret,
            refresh_token: current.refreshToken,
            grant_type: "refresh_token",
          })
        );
  const data = await readJson(res);
  if (!res.ok || !data.access_token) {
    // Revoked on the platform's side, or expired -- only a new consent fixes it.
    throw new SocialApiError("reconnect_required", describeError(data));
  }
  return {
    accessToken: data.access_token,
    // Google never rotates the refresh token; TikTok may.
    refreshToken: data.refresh_token ?? current.refreshToken,
    accessTokenExpiresAt: expiryFrom(data.expires_in),
    refreshTokenExpiresAt: platform === "tiktok" ? expiryFrom(data.refresh_expires_in) : null,
  };
}

// Best-effort: tells the platform to forget the grant when the user
// disconnects. Instagram has no revoke endpoint for this login type -- the
// token is simply deleted on our side.
export async function revokeTokens(
  platform: SocialPlatform,
  creds: PlatformCredentials,
  tokens: { accessToken: string; refreshToken: string | null }
): Promise<void> {
  try {
    if (platform === "youtube") {
      await apiFetch(
        "https://oauth2.googleapis.com/revoke",
        formBody({ token: tokens.refreshToken ?? tokens.accessToken })
      );
    } else if (platform === "tiktok") {
      await apiFetch(
        "https://open.tiktokapis.com/v2/oauth/revoke/",
        formBody({ client_key: creds.clientId, client_secret: creds.clientSecret, token: tokens.accessToken })
      );
    }
  } catch {}
}
