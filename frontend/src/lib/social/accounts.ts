import { prisma } from "@/lib/prisma";
import { SOCIAL_PLATFORMS, type SocialAccountStatus, type SocialPlatform } from "./platforms";
import { getCredentials } from "./config";
import { decryptToken, encryptToken } from "./crypto";
import { refreshTokens, revokeTokens, SocialApiError, type LinkedIdentity } from "./oauth";

// Refresh this long before the access token actually runs out, so a token
// can never expire in the middle of a multi-minute upload.
const REFRESH_MARGIN_MS = 10 * 60 * 1000;
// Instagram's 60-day token is renewed once it gets this close to expiring
// (it can only be refreshed while still valid, and not in its first 24h).
const INSTAGRAM_REFRESH_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function listAccountStatuses(userId: string): Promise<SocialAccountStatus[]> {
  const rows = await prisma.socialAccount.findMany({ where: { userId } });
  return SOCIAL_PLATFORMS.map((platform) => {
    const row = rows.find((r) => r.platform === platform);
    return {
      platform,
      configured: getCredentials(platform) !== null,
      connected: Boolean(row),
      displayName: row?.displayName ?? null,
    };
  });
}

// Reconnecting the same platform replaces the previous link.
export async function saveAccount(userId: string, platform: SocialPlatform, identity: LinkedIdentity) {
  const data = {
    externalId: identity.externalId,
    displayName: identity.displayName,
    accessTokenEnc: encryptToken(identity.accessToken),
    refreshTokenEnc: identity.refreshToken ? encryptToken(identity.refreshToken) : null,
    accessTokenExpiresAt: identity.accessTokenExpiresAt,
    refreshTokenExpiresAt: identity.refreshTokenExpiresAt,
    scopes: identity.scopes,
  };
  await prisma.socialAccount.upsert({
    where: { userId_platform: { userId, platform } },
    create: { userId, platform, ...data },
    update: data,
  });
}

export async function disconnectAccount(userId: string, platform: SocialPlatform): Promise<void> {
  const row = await prisma.socialAccount.findUnique({ where: { userId_platform: { userId, platform } } });
  if (!row) return;

  const creds = getCredentials(platform);
  const accessToken = decryptToken(row.accessTokenEnc);
  if (creds && accessToken) {
    await revokeTokens(platform, creds, {
      accessToken,
      refreshToken: row.refreshTokenEnc ? decryptToken(row.refreshTokenEnc) : null,
    });
  }
  await prisma.socialAccount.delete({ where: { id: row.id } });
}

// The linked account plus an access token guaranteed valid for at least
// REFRESH_MARGIN_MS -- refreshed (and re-saved) first when needed. Throws
// SocialApiError("not_connected" | "not_configured" | "reconnect_required").
export async function getUsableAccount(
  userId: string,
  platform: SocialPlatform
): Promise<{ accessToken: string; externalId: string; displayName: string }> {
  const creds = getCredentials(platform);
  if (!creds) throw new SocialApiError("not_configured");

  const row = await prisma.socialAccount.findUnique({ where: { userId_platform: { userId, platform } } });
  if (!row) throw new SocialApiError("not_connected");

  const accessToken = decryptToken(row.accessTokenEnc);
  const refreshToken = row.refreshTokenEnc ? decryptToken(row.refreshTokenEnc) : null;
  if (!accessToken) throw new SocialApiError("reconnect_required");

  const now = Date.now();
  const remainingMs = row.accessTokenExpiresAt ? row.accessTokenExpiresAt.getTime() - now : Infinity;
  const identity = { accessToken, externalId: row.externalId, displayName: row.displayName };

  if (platform === "instagram") {
    if (remainingMs <= REFRESH_MARGIN_MS) throw new SocialApiError("reconnect_required");
    const oldEnough = now - row.updatedAt.getTime() > DAY_MS;
    if (remainingMs > INSTAGRAM_REFRESH_WINDOW_MS || !oldEnough) return identity;
    // Still valid either way -- a failed early renewal is not worth failing
    // the publish over.
    try {
      const fresh = await refreshTokens(platform, creds, { accessToken, refreshToken });
      await prisma.socialAccount.update({
        where: { id: row.id },
        data: { accessTokenEnc: encryptToken(fresh.accessToken), accessTokenExpiresAt: fresh.accessTokenExpiresAt },
      });
      return { ...identity, accessToken: fresh.accessToken };
    } catch {
      return identity;
    }
  }

  if (remainingMs > REFRESH_MARGIN_MS) return identity;

  const fresh = await refreshTokens(platform, creds, { accessToken, refreshToken });
  await prisma.socialAccount.update({
    where: { id: row.id },
    data: {
      accessTokenEnc: encryptToken(fresh.accessToken),
      refreshTokenEnc: fresh.refreshToken ? encryptToken(fresh.refreshToken) : null,
      accessTokenExpiresAt: fresh.accessTokenExpiresAt,
      // Google gives no refresh-token expiry -- keep whatever was stored.
      ...(fresh.refreshTokenExpiresAt ? { refreshTokenExpiresAt: fresh.refreshTokenExpiresAt } : {}),
    },
  });
  return { ...identity, accessToken: fresh.accessToken };
}
