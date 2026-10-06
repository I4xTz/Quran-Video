import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { isSocialPlatform } from "@/lib/social/platforms";
import { disconnectAccount } from "@/lib/social/accounts";

// Unlinks the account: revokes the grant on the platform where possible and
// deletes the stored tokens. Videos already published stay published.
export async function DELETE(_req: Request, { params }: { params: { platform: string } }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }
  const { platform } = params;
  if (!isSocialPlatform(platform)) {
    return NextResponse.json({ error: "unknown_platform" }, { status: 404 });
  }

  await disconnectAccount(session.id, platform);
  return NextResponse.json({ success: true });
}
