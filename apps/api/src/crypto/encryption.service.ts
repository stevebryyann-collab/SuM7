import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { decryptField, encryptField, parseKeyVersion } from '@b2b/shared';
import { AppConfigService } from '../config/app-config.service';

/**
 * Application-level field encryption (AES-256-GCM) for PII and secrets at rest:
 * Shopify access tokens, buyer tax ids, phone numbers, MFA secrets.
 *
 * Keys are loaded once at boot from ENCRYPTION_KEY_V{n} env vars (base64, 32
 * bytes each). The active version for new writes is CURRENT_ENCRYPTION_KEY_VERSION.
 * Old ciphertexts remain decryptable as long as their key version is still
 * present, enabling zero-downtime key rotation.
 */
@Injectable()
export class EncryptionService implements OnModuleInit {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly keys = new Map<number, Buffer>();
  private currentVersion = 1;

  constructor(private readonly config: AppConfigService) {}

  onModuleInit(): void {
    this.currentVersion = this.config.get('CURRENT_ENCRYPTION_KEY_VERSION');
    this.loadKey(1, this.config.get('ENCRYPTION_KEY_V1'));

    // Optional rotation key.
    const v2 = this.config.get('ENCRYPTION_KEY_V2');
    if (v2) this.loadKey(2, v2);

    if (!this.keys.has(this.currentVersion)) {
      throw new Error(
        `CURRENT_ENCRYPTION_KEY_VERSION=${this.currentVersion} has no matching key loaded`,
      );
    }
    this.logger.log(
      `Encryption ready (current v${this.currentVersion}, ${this.keys.size} key(s) loaded)`,
    );
  }

  private loadKey(version: number, base64: string): void {
    const key = Buffer.from(base64, 'base64');
    if (key.length !== 32) {
      throw new Error(`ENCRYPTION_KEY_V${version} must decode to 32 bytes, got ${key.length}`);
    }
    this.keys.set(version, key);
  }

  private resolveKey(version: number): Buffer {
    const key = this.keys.get(version);
    if (!key) {
      throw new Error(`No encryption key loaded for version ${version}`);
    }
    return key;
  }

  /** Encrypt plaintext under the current key version. */
  encrypt(plaintext: string): string {
    const key = this.resolveKey(this.currentVersion);
    return encryptField(plaintext, key, this.currentVersion);
  }

  /** Decrypt a versioned ciphertext, selecting the key from its prefix. */
  decrypt(ciphertext: string): string {
    return decryptField(ciphertext, (version) => this.resolveKey(version));
  }

  /** The key version that produced a given ciphertext. */
  versionOf(ciphertext: string): number {
    return parseKeyVersion(ciphertext);
  }

  /**
   * If `ciphertext` was encrypted under an older key version, decrypt and
   * re-encrypt it under the current version. Returns the (possibly new)
   * ciphertext; callers persist it when it differs from the input.
   */
  reencryptIfNeeded(ciphertext: string): string {
    if (parseKeyVersion(ciphertext) === this.currentVersion) {
      return ciphertext;
    }
    const plaintext = this.decrypt(ciphertext);
    return this.encrypt(plaintext);
  }
}
