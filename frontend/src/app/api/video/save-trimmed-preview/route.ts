import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { PREPARED_AUDIO_REL_DIR } from "@/lib/preparedAudio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Persists a client-side-cut audio preview (see SegmentTimingEditor's
// applyTrimOnly, which does the actual cutting via the Web Audio API in the
// browser) so it survives the timing editor being closed and reopened --
// without this, only in-memory Blob URLs held it, discarded the moment the
// editor unmounted. Lives in the SAME persistent directory prepare-audio
// writes to (PREPARED_AUDIO_REL_DIR), so it survives container restarts
// and is covered by the existing /api/video/cleanup route.
export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const audio = formData.get("audio") as File | null;
    if (!audio || audio.size === 0) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }

    const dir = path.join(process.cwd(), "public", PREPARED_AUDIO_REL_DIR);
    await fs.mkdir(dir, { recursive: true });

    const filename = `trimmed-preview-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`;
    const absolutePath = path.join(dir, filename);
    const buffer = Buffer.from(await audio.arrayBuffer());
    await fs.writeFile(absolutePath, buffer);

    const audioUrl = `/api/serve-audio?file=${PREPARED_AUDIO_REL_DIR}/${filename}&t=${Date.now()}`;
    return NextResponse.json({ success: true, audioUrl });
  } catch (error: any) {
    console.error("[Save Trimmed Preview] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
