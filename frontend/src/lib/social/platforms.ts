// Shared by server and client code -- nothing in here may import a
// server-only module (prisma, fs, crypto...).

export const SOCIAL_PLATFORMS = ["youtube", "tiktok", "instagram"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export function isSocialPlatform(value: unknown): value is SocialPlatform {
  return typeof value === "string" && (SOCIAL_PLATFORMS as readonly string[]).includes(value);
}

export const PLATFORM_LABEL: Record<SocialPlatform, { ar: string; tr: string }> = {
  youtube: { ar: "يوتيوب", tr: "YouTube" },
  tiktok: { ar: "تيك توك", tr: "TikTok" },
  instagram: { ar: "إنستغرام", tr: "Instagram" },
};

// What GET /api/social/accounts returns for each platform.
export type SocialAccountStatus = {
  platform: SocialPlatform;
  // False when this server has no API credentials for the platform (see
  // .env.example) -- the connect button is disabled rather than sending the
  // user into an OAuth screen that can only fail.
  configured: boolean;
  connected: boolean;
  displayName: string | null;
};

export type PublishVisibility = "public" | "private";

export type PublishRequest = {
  galleryId: string;
  // YouTube title (ignored by TikTok/Instagram, which only have a caption).
  title: string;
  // YouTube description / TikTok + Instagram caption.
  caption: string;
  visibility: PublishVisibility;
};

export type PublishResult = {
  // "processing": the platform accepted the upload but had not finished
  // processing it when we stopped waiting -- it normally appears on its own
  // a little later. "draft": sent to the TikTok inbox, the user finishes
  // posting inside the TikTok app (TIKTOK_POST_MODE=inbox).
  status: "published" | "processing" | "draft";
  url: string | null;
  // Set when the platform forced a narrower audience than the one asked for.
  visibility: PublishVisibility;
};

// Saved on the gallery entry after a successful publish (see videoGallery.ts).
export type GalleryPublishRecord = PublishResult & { publishedAt: string };

export const YOUTUBE_TITLE_MAX = 100;
export const YOUTUBE_DESCRIPTION_MAX = 5000;
// Instagram's and TikTok's caption limits are both 2200.
export const CAPTION_MAX = 2200;
