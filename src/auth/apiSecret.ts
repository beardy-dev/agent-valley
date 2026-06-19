import crypto from "node:crypto";

const SCRYPT_KEY_LENGTH = 64;

/** Plaintext secret to hand back to the agent once, at registration time. */
export function generateApiSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** Salted hash to persist instead of the plaintext secret. */
export function hashApiSecret(secret: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(secret, salt, SCRYPT_KEY_LENGTH);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyApiSecret(secret: string, storedHash: string): boolean {
  const [saltHex, hashHex] = storedHash.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const candidate = crypto.scryptSync(secret, salt, SCRYPT_KEY_LENGTH);
  return crypto.timingSafeEqual(candidate, expected);
}
