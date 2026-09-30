import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { streamFileResponse } from "@/lib/serveFile";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const file = searchParams.get("file");

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // Ensure it only reads from public directory
  const publicDir = path.join(process.cwd(), "public");
  const absolutePath = path.resolve(publicDir, file.replace(/^[/\\]+/, ""));
  if (!absolutePath.startsWith(publicDir + path.sep)) {
    return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
  }

  try {
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const ext = path.extname(absolutePath).toLowerCase();
    let contentType = "application/octet-stream";
    if (ext === ".mp3") contentType = "audio/mpeg";
    else if (ext === ".wav") contentType = "audio/wav";
    else if (ext === ".png") contentType = "image/png";
    else if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";
    else if (ext === ".webp") contentType = "image/webp";
    else if (ext === ".mp4") contentType = "video/mp4";
    else if (ext === ".ttf") contentType = "font/ttf";
    else if (ext === ".otf") contentType = "font/otf";
    else if (ext === ".woff") contentType = "font/woff";
    else if (ext === ".woff2") contentType = "font/woff2";

    return streamFileResponse(absolutePath, contentType, request.headers.get("range"));
  } catch (error) {
    console.error("Error serving audio:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
