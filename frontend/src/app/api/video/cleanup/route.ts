import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { PREPARED_AUDIO_REL_DIR } from "@/lib/preparedAudio";
import { getSession } from "@/lib/auth/session";
import { isAdminEmail } from "@/lib/auth/admin";
import { pruneAbandonedDrafts } from "@/lib/drafts";
import { listLinkedDraftIds } from "@/lib/videoGallery";

export const runtime = "nodejs";

async function clearDirectory(dirPath: string) {
  try {
    const files = await fs.readdir(dirPath);
    for (const file of files) {
      if (file === ".gitkeep") continue;
      const fullPath = path.join(dirPath, file);
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        await fs.rm(fullPath, { recursive: true, force: true });
      } else {
        await fs.unlink(fullPath);
      }
    }
  } catch (error: any) {
    if (error.code !== "ENOENT") {
      console.warn(`Failed to clear directory ${dirPath}:`, error.message);
    }
  }
}

export async function DELETE() {
  // Wipes EVERY user's temp files -- admins only.
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }
  if (!isAdminEmail(session.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    // 1. Clear frontend generated files
    const pathsToClear = [
      path.join(process.cwd(), "public", "renders", "temp_audio"),
      path.join(process.cwd(), "public", PREPARED_AUDIO_REL_DIR),
      path.join(process.cwd(), "public", "renders", "output"),
      path.join(process.cwd(), "public", "render-assets", "generated-bg"),
    ];

    await Promise.all(pathsToClear.map(clearDirectory));

    // Drafts are NOT wiped here: they are users' projects, each one deleted
    // by its own user. Only the abandoned ones go (see drafts.ts) -- the
    // same rule that already runs on its own from /api/drafts.
    await pruneAbandonedDrafts(await listLinkedDraftIds());
    
    // 2. Call backend cleanup
    const baseUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://backend:8000";
    try {
      const response = await fetch(`${baseUrl}/api/extraction/cleanup/all`, {
        method: "DELETE",
        cache: "no-store",
      });
      if (!response.ok) {
        console.warn(`Backend cleanup failed with status: ${response.status}`);
      }
    } catch (backendError: any) {
      console.warn(`Backend cleanup request failed: ${backendError.message}`);
    }

    return NextResponse.json({ success: true, message: "Cleanup successful" });
  } catch (error: any) {
    console.error("[Cleanup API] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
