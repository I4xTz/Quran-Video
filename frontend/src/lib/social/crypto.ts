import crypto from "crypto";

// Platform tokens have to be read back to call the platform, so they can't
// be hashed like the reset/verify tokens -- they are encrypted instead. The
// key is derived from AUTH_SECRET (already required, already validated in
// session.ts) so there is no second secret to manage; rotating AUTH_SECRET
// simply makes every linked account read as "disconnected".
function getKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET environment variable is not set");
  }
  return crypto.createHash("sha256").update(`social-tokens:${secret}`).digest();
}

// Output: base64(iv).base64(authTag).base64(ciphertext)
export function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString("base64")).join(".");
}

// Returns null instead of throwing for anything that doesn't decrypt (key
// rotated, row tampered with) -- callers treat that as "not connected".
export function decryptToken(encrypted: string): string | null {
  try {
    const [iv, tag, ciphertext] = encrypted.split(".").map((part) => Buffer.from(part, "base64"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
