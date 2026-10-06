import fs from "fs";
import type { PublishRequest, PublishResult, SocialPlatform } from "./platforms";
import { CAPTION_MAX, YOUTUBE_DESCRIPTION_MAX, YOUTUBE_TITLE_MAX } from "./platforms";
import { tiktokPostMode } from "./config";
import { apiFetch, INSTAGRAM_GRAPH, readJson, SocialApiError } from "./oauth";

type Account = { accessToken: string; externalId: string };
type PublishInput = Omit<PublishRequest, "galleryId">;

const MB = 1024 * 1024;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A file-backed Blob: fetch streams it from disk with a known length (so a
// real Content-Length is sent, which TikTok and YouTube both insist on)
// without the whole video ever being held in memory.
async function openVideo(filePath: string): Promise<Blob> {
  return (await fs.openAsBlob(filePath, { type: "video/mp4" })) as unknown as Blob;
}

function platformMessage(data: any): string {
  const err = data?.error;
  if (typeof err === "string") return err;
  return err?.error_user_msg ?? err?.message ?? data?.debug_info?.message ?? data?.raw ?? "unknown error";
}

// ---------------------------------------------------------------- YouTube

async function publishToYouTube(account: Account, video: Blob, input: PublishInput): Promise<PublishResult> {
  const metadata = {
    snippet: {
      // YouTube rejects angle brackets in titles and descriptions.
      title: input.title.replace(/[<>]/g, "").slice(0, YOUTUBE_TITLE_MAX) || "Quran",
      description: input.caption.replace(/[<>]/g, "").slice(0, YOUTUBE_DESCRIPTION_MAX),
      categoryId: "22",
    },
    status: {
      privacyStatus: input.visibility,
      selfDeclaredMadeForKids: false,
    },
  };

  const initRes = await apiFetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(video.size),
      },
      body: JSON.stringify(metadata),
    }
  );
  const uploadUrl = initRes.headers.get("location");
  if (!initRes.ok || !uploadUrl) {
    const data = await readJson(initRes);
    const reason = data?.error?.errors?.[0]?.reason;
    if (initRes.status === 401) throw new SocialApiError("reconnect_required", platformMessage(data));
    if (reason === "quotaExceeded" || reason === "uploadLimitExceeded") {
      throw new SocialApiError("quota_exceeded", platformMessage(data));
    }
    throw new SocialApiError("upload_failed", platformMessage(data));
  }

  const uploadRes = await apiFetch(uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${account.accessToken}`, "Content-Type": "video/mp4" },
    body: video,
  });
  const data = await readJson(uploadRes);
  if (!uploadRes.ok || !data.id) {
    throw new SocialApiError("upload_failed", platformMessage(data));
  }

  return {
    status: "published",
    url: `https://www.youtube.com/watch?v=${data.id}`,
    // An API project that hasn't passed Google's audit gets every upload
    // locked to private regardless of what was asked for.
    visibility: data.status?.privacyStatus === "public" ? "public" : "private",
  };
}

// ----------------------------------------------------------------- TikTok

const TIKTOK_API = "https://open.tiktokapis.com/v2";
// TikTok: every chunk 5-64MB (the last one may run over), a video under
// 64MB may simply go up as one chunk.
const TIKTOK_SINGLE_CHUNK_MAX = 64 * MB;
const TIKTOK_CHUNK_SIZE = 32 * MB;

async function tiktokPost(account: Account, path: string, body?: unknown): Promise<any> {
  const res = await apiFetch(`${TIKTOK_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${account.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await readJson(res);
  const code = data?.error?.code;
  if (!res.ok || (code && code !== "ok")) {
    if (res.status === 401 || code === "access_token_invalid") {
      throw new SocialApiError("reconnect_required", platformMessage(data));
    }
    if (code === "scope_not_authorized") throw new SocialApiError("reconnect_required", platformMessage(data));
    if (code === "unaudited_client_can_only_post_to_private_accounts") {
      throw new SocialApiError("tiktok_unaudited", platformMessage(data));
    }
    if (code === "spam_risk_too_many_posts" || code === "rate_limit_exceeded") {
      throw new SocialApiError("quota_exceeded", platformMessage(data));
    }
    throw new SocialApiError("upload_failed", `${code ?? res.status}: ${platformMessage(data)}`);
  }
  return data.data ?? {};
}

async function publishToTikTok(account: Account, video: Blob, input: PublishInput): Promise<PublishResult> {
  const inbox = tiktokPostMode() === "inbox";
  const size = video.size;
  const chunkSize = size <= TIKTOK_SINGLE_CHUNK_MAX ? size : TIKTOK_CHUNK_SIZE;
  const chunkCount = Math.max(1, Math.floor(size / chunkSize));
  const source_info = { source: "FILE_UPLOAD", video_size: size, chunk_size: chunkSize, total_chunk_count: chunkCount };

  let visibility = input.visibility;
  let init;
  if (inbox) {
    init = await tiktokPost(account, "/post/publish/inbox/video/init/", { source_info });
  } else {
    // TikTok requires asking the creator's current settings first and only
    // posting with a privacy level it lists for them.
    const creator = await tiktokPost(account, "/post/publish/creator_info/query/");
    const options: string[] = creator.privacy_level_options ?? [];
    let privacyLevel = "SELF_ONLY";
    if (input.visibility === "public" && options.includes("PUBLIC_TO_EVERYONE")) {
      privacyLevel = "PUBLIC_TO_EVERYONE";
    } else {
      // Asked for public on an account that can't post publicly (a private
      // account): narrower is the only safe fallback.
      visibility = "private";
    }
    init = await tiktokPost(account, "/post/publish/video/init/", {
      post_info: {
        title: input.caption.slice(0, CAPTION_MAX),
        privacy_level: privacyLevel,
        disable_comment: Boolean(creator.comment_disabled),
        disable_duet: Boolean(creator.duet_disabled),
        disable_stitch: Boolean(creator.stitch_disabled),
      },
      source_info,
    });
  }
  if (!init.upload_url || !init.publish_id) {
    throw new SocialApiError("upload_failed", "TikTok returned no upload URL");
  }

  for (let i = 0; i < chunkCount; i++) {
    const start = i * chunkSize;
    // The final chunk also carries whatever is left over.
    const end = i === chunkCount - 1 ? size : start + chunkSize;
    const res = await apiFetch(init.upload_url, {
      method: "PUT",
      headers: { "Content-Type": "video/mp4", "Content-Range": `bytes ${start}-${end - 1}/${size}` },
      body: video.slice(start, end, "video/mp4"),
    });
    if (!res.ok) {
      throw new SocialApiError("upload_failed", `TikTok chunk ${i + 1}/${chunkCount}: HTTP ${res.status}`);
    }
  }

  if (inbox) {
    return { status: "draft", url: null, visibility };
  }

  // TikTok processes the post asynchronously; give it a little while so a
  // rejection (bad format, moderation...) is reported instead of hidden.
  for (let attempt = 0; attempt < 20; attempt++) {
    await sleep(3000);
    const status = await tiktokPost(account, "/post/publish/status/fetch/", { publish_id: init.publish_id });
    if (status.status === "PUBLISH_COMPLETE") {
      return { status: "published", url: null, visibility };
    }
    if (status.status === "FAILED") {
      throw new SocialApiError("upload_failed", `TikTok: ${status.fail_reason ?? "FAILED"}`);
    }
  }
  return { status: "processing", url: null, visibility };
}

// -------------------------------------------------------------- Instagram

async function instagramCall(url: string, init?: RequestInit): Promise<any> {
  const res = await apiFetch(url, init);
  const data = await readJson(res);
  if (!res.ok || data.error) {
    // 190 = token expired/revoked.
    if (data?.error?.code === 190) throw new SocialApiError("reconnect_required", platformMessage(data));
    if (data?.error?.code === 4 || data?.error?.code === 9) {
      throw new SocialApiError("quota_exceeded", platformMessage(data));
    }
    throw new SocialApiError("upload_failed", platformMessage(data));
  }
  return data;
}

async function publishToInstagram(account: Account, video: Blob, input: PublishInput): Promise<PublishResult> {
  // Instagram has no private posts -- never publish publicly something the
  // user asked to keep private.
  if (input.visibility !== "public") {
    throw new SocialApiError("instagram_public_only");
  }
  const token = account.accessToken;
  const form = (params: Record<string, string>) => ({
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, access_token: token }).toString(),
  });

  // 1. A Reels container that expects the bytes to be pushed to it (rather
  //    than pulled from a public URL this server may not even have).
  const container = await instagramCall(
    `${INSTAGRAM_GRAPH}/${account.externalId}/media`,
    form({ media_type: "REELS", upload_type: "resumable", caption: input.caption.slice(0, CAPTION_MAX) })
  );
  const uploadUrl: string =
    container.uri ?? `https://rupload.facebook.com/ig-api-upload/${INSTAGRAM_GRAPH.split("/").pop()}/${container.id}`;

  // 2. The bytes.
  await instagramCall(uploadUrl, {
    method: "POST",
    headers: { Authorization: `OAuth ${token}`, offset: "0", file_size: String(video.size) },
    body: video,
  });

  // 3. Instagram transcodes before the container may be published.
  let ready = false;
  for (let attempt = 0; attempt < 100 && !ready; attempt++) {
    await sleep(3000);
    const state = await instagramCall(
      `${INSTAGRAM_GRAPH}/${container.id}?fields=status_code,status&access_token=${encodeURIComponent(token)}`
    );
    if (state.status_code === "FINISHED") ready = true;
    else if (state.status_code === "ERROR" || state.status_code === "EXPIRED") {
      throw new SocialApiError("upload_failed", `Instagram: ${state.status ?? state.status_code}`);
    }
  }
  if (!ready) {
    throw new SocialApiError("upload_failed", "Instagram did not finish processing the video in time");
  }

  // 4. Publish.
  const published = await instagramCall(
    `${INSTAGRAM_GRAPH}/${account.externalId}/media_publish`,
    form({ creation_id: container.id })
  );

  let url: string | null = null;
  try {
    const media = await instagramCall(
      `${INSTAGRAM_GRAPH}/${published.id}?fields=permalink&access_token=${encodeURIComponent(token)}`
    );
    url = media.permalink ?? null;
  } catch {}

  return { status: "published", url, visibility: "public" };
}

export async function publishVideo(
  platform: SocialPlatform,
  account: Account,
  filePath: string,
  input: PublishInput
): Promise<PublishResult> {
  const video = await openVideo(filePath);
  if (platform === "youtube") return publishToYouTube(account, video, input);
  if (platform === "tiktok") return publishToTikTok(account, video, input);
  return publishToInstagram(account, video, input);
}
