import type { SocialPlatform } from "./platforms";

export type PlatformCredentials = { clientId: string; clientSecret: string };

const ENV_NAMES: Record<SocialPlatform, [string, string]> = {
  youtube: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  tiktok: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
  instagram: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"],
};

// null = this server has no API app registered for the platform yet.
export function getCredentials(platform: SocialPlatform): PlatformCredentials | null {
  const [idName, secretName] = ENV_NAMES[platform];
  const clientId = process.env[idName]?.trim();
  const clientSecret = process.env[secretName]?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

// "direct" publishes the video on the account (needs the video.publish
// scope). "inbox" only delivers it to the creator's TikTok inbox as a draft
// they finish posting inside the app (video.upload scope) -- useful while
// the TikTok app is still unaudited, when direct posts are forced private.
export function tiktokPostMode(): "direct" | "inbox" {
  return process.env.TIKTOK_POST_MODE?.trim().toLowerCase() === "inbox" ? "inbox" : "direct";
}

// The public origin the platforms redirect back to. Must match, character
// for character, a redirect URI registered in each platform's developer
// console -- so APP_URL wins when set (required behind a tunnel/proxy whose
// Host header isn't the public one); otherwise it's derived from the request.
export function appBaseUrl(req: Request): string {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;

  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export function redirectUri(req: Request, platform: SocialPlatform): string {
  return `${appBaseUrl(req)}/api/social/${platform}/callback`;
}
