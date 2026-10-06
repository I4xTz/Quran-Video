import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rateLimit";
import { getSession } from "@/lib/auth/session";
import { getGalleryVideo, recordGalleryPublish } from "@/lib/videoGallery";
import { isSocialPlatform } from "@/lib/social/platforms";
import { getUsableAccount } from "@/lib/social/accounts";
import { SocialApiError } from "@/lib/social/oauth";
import { publishVideo } from "@/lib/social/publish";

const ERROR_STATUS: Record<string, number> = {
  not_configured: 503,
  not_connected: 409,
  reconnect_required: 409,
  instagram_public_only: 400,
  quota_exceeded: 429,
};

// Uploads one saved gallery video to one platform and waits for the
// platform's answer -- the browser fires one of these per selected platform
// in parallel (see PublishDialog.tsx), so each reports its own progress and
// one platform failing never holds back the others. Can legitimately take
// minutes (the upload itself, then Instagram/TikTok processing).
export async function POST(req: Request, { params }: { params: { platform: string } }) {
  const limited = rateLimit(req, "social-publish", 30, 10 * 60 * 1000);
  if (limited) return limited;

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }
  const { platform } = params;
  if (!isSocialPlatform(platform)) {
    return NextResponse.json({ error: "unknown_platform" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const galleryId = typeof body?.galleryId === "string" ? body.galleryId : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const caption = typeof body?.caption === "string" ? body.caption.trim() : "";
  // Anything that isn't an explicit "public" is treated as private.
  const visibility = body?.visibility === "public" ? "public" : "private";

  const video = await getGalleryVideo(galleryId, session.id);
  if (!video) {
    return NextResponse.json({ error: "video_not_found" }, { status: 404 });
  }

  try {
    const account = await getUsableAccount(session.id, platform);
    const result = await publishVideo(platform, account, video.filePath, { title, caption, visibility });
    try {
      await recordGalleryPublish(galleryId, session.id, video.entry.updatedAt, platform, {
        ...result,
        publishedAt: new Date().toISOString(),
      });
    } catch (err) {
      // The video IS published -- failing to note that on the card must not
      // turn the response into an error (the user would publish it twice).
      console.error(`[social/${platform}/publish] Failed to record publish:`, err);
    }
    return NextResponse.json({ result });
  } catch (err) {
    console.error(`[social/${platform}/publish] Failed:`, err);
    if (err instanceof SocialApiError) {
      return NextResponse.json(
        { error: err.code, detail: err.message === err.code ? undefined : err.message },
        { status: ERROR_STATUS[err.code] ?? 502 }
      );
    }
    return NextResponse.json({ error: "upload_failed" }, { status: 500 });
  }
}
