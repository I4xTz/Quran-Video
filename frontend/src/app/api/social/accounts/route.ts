import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { listAccountStatuses } from "@/lib/social/accounts";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }
  return NextResponse.json({ accounts: await listAccountStatuses(session.id) });
}
