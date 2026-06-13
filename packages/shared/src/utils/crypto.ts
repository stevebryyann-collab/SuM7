/**
 * Cryptographic primitives backed exclusively by Node's built-in `crypto`.
 * No third-party crypto libraries — auditability over convenience.
 *
 * Field encryption format (versioned for key rotation):
 *   v{ver}:{iv_b64}:{authTag_b64}:{ciphertext_b64}
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual as nodeTimingSafeEqual,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, recommended for GCM
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32; // AES-256

/** Resolver that maps an encryption key version to its 32-byte raw key. */
export type KeyResolver = (version: number) => Buffer;

function assertKey(key: Buffer): void {
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `Invalid encryption key length: expected ${KEY_LENGTH} bytes, got ${key.length}`,
    );
  }
}

/**
 * Encrypt a UTF-8 plaintext with AES-256-GCM under the given key/version.
 * Returns a self-describing string that embeds the key version so the correct
 * key can be selected at decryption time.
 */
export function encryptField(plaintext: string, key: Buffer, keyVersion: number): string {
  assertKey(key);
  if (!Number.isInteger(keyVersion) || keyVersion < 1) {
    throw new Error(`Invalid key version: ${keyVersion}`);
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    `v${keyVersion}`,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/**
 * Decrypt a value produced by {@link encryptField}. The key version is parsed
 * from the `v{ver}` prefix and resolved via `keyResolver`.
 */
export function decryptField(encrypted: string, keyResolver: KeyResolver): string {
  const parts = encrypted.split(':');
  if (parts.length !== 4) {
    throw new Error('Malformed ciphertext: expected 4 colon-delimited segments');
  }
  const [versionTag, ivB64, authTagB64, ciphertextB64] = parts as [
    string,
    string,
    string,
    string,
  ];
  if (!versionTag.startsWith('v')) {
    throw new Error('Malformed ciphertext: missing version prefix');
  }
  const version = Number.parseInt(versionTag.slice(1), 10);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`Malformed ciphertext: invalid version "${versionTag}"`);
  }
  const key = keyResolver(version);
  assertKey(key);

  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Parse the key version from a ciphertext without decrypting it. */
export function parseKeyVersion(encrypted: string): number {
  const versionTag = encrypted.split(':', 1)[0] ?? '';
  if (!versionTag.startsWith('v')) {
    throw new Error('Malformed ciphertext: missing version prefix');
  }
  const version = Number.parseInt(versionTag.slice(1), 10);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`Malformed ciphertext: invalid version "${versionTag}"`);
  }
  return version;
}

/** SHA-256 hex digest — used for refresh-token storage and request hashing. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Cryptographically-random hex token (default 32 bytes → 64 hex chars). */
export function generateSecureToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

/** RFC 4122 v4 UUID, used as a JWT `jti`. */
export function generateJti(): string {
  return randomUUID();
}

/**
 * Constant-time string comparison. Returns false (without leaking length via
 * timing) when the inputs differ in length.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Compare against itself to keep the work constant-ish, then fail.
    nodeTimingSafeEqual(bufA, bufA);
    return false;
  }
  return nodeTimingSafeEqual(bufA, bufB);
}
