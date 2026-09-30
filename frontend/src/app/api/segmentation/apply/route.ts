import { NextResponse } from "next/server";
import { normalizeSegmentation } from "@/lib/segmentation";

// Validation only -- lets the UI warn about a bad segmentation before a
// render. Nothing is stored server-side: /api/video/render receives the
// segmentation in each request's own form data (see normalizeSegmentation).
export async function POST(req: Request) {
  try {
    const data = await req.json();
    const result = await normalizeSegmentation(data);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ success: true, data: result.data });
  } catch (error) {
    console.error("[Segmentation Apply] Validation failed with error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to validate segmentation data" },
      { status: 500 }
    );
  }
}
