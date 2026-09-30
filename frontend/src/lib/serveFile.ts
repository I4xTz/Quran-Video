import fs from "fs";
import { Readable } from "stream";
import { NextResponse } from "next/server";

// Streams a file from disk with HTTP Range support. Reading the whole file
// into memory on every (partial) request -- which video/audio players make
// many of -- doesn't hold up once several people watch videos at once.
export function streamFileResponse(absolutePath: string, contentType: string, rangeHeader: string | null) {
  const total = fs.statSync(absolutePath).size;
  const baseHeaders = {
    "Accept-Ranges": "bytes",
    "Content-Type": contentType,
    "Cache-Control": "no-store, max-age=0",
  };

  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    let start = match && match[1] ? parseInt(match[1], 10) : NaN;
    let end = match && match[2] ? parseInt(match[2], 10) : total - 1;
    // "bytes=-N" means the last N bytes.
    if (match && !match[1] && match[2]) {
      start = Math.max(0, total - parseInt(match[2], 10));
      end = total - 1;
    }
    end = Math.min(end, total - 1);

    if (!Number.isFinite(start) || start > end || start >= total) {
      return new NextResponse(null, {
        status: 416,
        headers: { ...baseHeaders, "Content-Range": `bytes */${total}` },
      });
    }

    const stream = Readable.toWeb(fs.createReadStream(absolutePath, { start, end })) as ReadableStream;
    return new NextResponse(stream, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }

  const stream = Readable.toWeb(fs.createReadStream(absolutePath)) as ReadableStream;
  return new NextResponse(stream, {
    status: 200,
    headers: { ...baseHeaders, "Content-Length": String(total) },
  });
}
