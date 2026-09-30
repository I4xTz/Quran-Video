// Comma-separated ADMIN_EMAILS env var -- the only accounts allowed to run
// server-wide maintenance such as /api/video/cleanup, which wipes every
// user's temp files and drafts.
export function isAdminEmail(email: string): boolean {
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.toLowerCase());
}
