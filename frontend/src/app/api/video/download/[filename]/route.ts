import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { streamFileResponse } from "@/lib/serveFile";

const RENDERS_DIR = path.join(process.cwd(), "public", "renders");

export async function GET(
  req: Request,
  { params }: { params: { filename: string } }
) {
  try {
    const filename = path.basename(params.filename);
    const filePath = path.join(RENDERS_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    return streamFileResponse(filePath, "video/mp4", req.headers.get("range"));
  } catch (error) {
    console.error("Error serving video:", error);
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }
}
