// Holds "<platform>.<random state>" between ../connect and ../callback so
// the callback can prove the consent it's being handed was started by this
// same browser (CSRF protection for the OAuth flow). sameSite "lax" is
// required: the platform returns the user with a cross-site top-level GET.
export const OAUTH_STATE_COOKIE = "social_oauth_state";

export function oauthStateCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/api/social",
    maxAge: 10 * 60,
  };
}
