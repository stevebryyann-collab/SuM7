import { ForbiddenException, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type CircuitBreaker from 'opossum';
import { AppConfigService } from '../config/app-config.service';
import { CircuitBreakerFactory } from '../common/circuit-breaker/circuit-breaker.factory';
import { PrismaService } from '../prisma/prisma.service';

export interface UploadInvoiceParams {
  merchantId: string;
  invoiceNumber: string;
  body: Buffer;
  contentType?: string;
}

export interface UploadResult {
  key: string;
}

const DEFAULT_PRESIGN_TTL_SECONDS = 3600;
const INVOICE_PREFIX = 'invoices/';

/**
 * AWS S3 object storage for invoice PDFs. Every object is encrypted at rest with
 * SSE-KMS; the bucket is private and downloads are served via short-lived
 * presigned URLs only. Object keys are built from validated, path-traversal-safe
 * segments. The network `PutObject` call is wrapped in a circuit breaker.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly kmsKeyArn: string;
  private putBreaker!: CircuitBreaker<[PutObjectCommandInput], void>;

  constructor(
    private readonly config: AppConfigService,
    private readonly breakerFactory: CircuitBreakerFactory,
    private readonly prisma: PrismaService,
  ) {
    this.bucket = this.config.get('S3_BUCKET_NAME');
    this.kmsKeyArn = this.config.get('S3_KMS_KEY_ARN');
    this.s3 = new S3Client({ region: this.config.get('S3_REGION') });
  }

  onModuleInit(): void {
    this.putBreaker = this.breakerFactory.create<[PutObjectCommandInput], void>(
      's3:put',
      async (input: PutObjectCommandInput) => {
        await this.s3.send(new PutObjectCommand(input));
      },
    );
  }

  /**
   * Upload an invoice PDF under `invoices/{merchantId}/{year}/{invoiceNumber}.pdf`,
   * encrypted with SSE-KMS. Both path segments are validated so a malicious
   * invoice number can never escape the prefix. Returns the S3 KEY (not a URL).
   */
  async uploadInvoice(params: UploadInvoiceParams): Promise<UploadResult> {
    const merchant = this.safeSegment(params.merchantId);
    const invoice = this.safeSegment(params.invoiceNumber);
    const year = String(new Date().getUTCFullYear());
    const key = `${INVOICE_PREFIX}${merchant}/${year}/${invoice}.pdf`;

    await this.putBreaker.fire({
      Bucket: this.bucket,
      Key: key,
      Body: params.body,
      ContentType: params.contentType ?? 'application/pdf',
      ContentDisposition: 'inline',
      ACL: 'private',
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: this.kmsKeyArn,
    });

    this.logger.log(`Uploaded invoice object ${key} (${params.body.length} bytes)`);
    return { key };
  }

  /**
   * Generate a short-lived presigned GET URL for a stored invoice object. The key
   * MUST live under the `invoices/` prefix — anything else is rejected as a path
   * traversal attempt. Never returns a raw (unsigned) S3 URL.
   */
  async getPresignedUrl(s3Key: string, expiresInSeconds = DEFAULT_PRESIGN_TTL_SECONDS): Promise<string> {
    if (!s3Key.startsWith(INVOICE_PREFIX) || s3Key.includes('..')) {
      throw new ForbiddenException({
        code: 'PATH_TRAVERSAL_ATTEMPT',
        message: 'Refusing to sign a key outside the invoices prefix',
      });
    }
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: s3Key });
    return getSignedUrl(this.s3, command, { expiresIn: expiresInSeconds });
  }

  /**
   * Download a stored object's bytes (used for PDF integrity verification). The
   * key must live under the `invoices/` prefix.
   */
  async downloadObject(s3Key: string): Promise<Buffer> {
    if (!s3Key.startsWith(INVOICE_PREFIX) || s3Key.includes('..')) {
      throw new ForbiddenException({
        code: 'PATH_TRAVERSAL_ATTEMPT',
        message: 'Refusing to read a key outside the invoices prefix',
      });
    }
    const response = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: s3Key }),
    );
    const body = response.Body;
    if (!body) {
      throw new Error(`S3 object ${s3Key} has no body`);
    }
    const bytes = await body.transformToByteArray();
    return Buffer.from(bytes);
  }

  /**
   * Best-effort presigned GET used by the invoice-generate worker's email step.
   * Kept for backwards compatibility with existing callers; delegates to
   * {@link getPresignedUrl} so the same prefix validation applies.
   */
  async presignDownload(key: string, ttlSeconds = DEFAULT_PRESIGN_TTL_SECONDS): Promise<string> {
    return this.getPresignedUrl(key, ttlSeconds);
  }

  /**
   * Delete a stored object. System-role only (financial PDFs are normally
   * retained); the key format is validated and the deletion is audited.
   */
  async deleteObject(s3Key: string): Promise<void> {
    if (!s3Key.startsWith(INVOICE_PREFIX) || s3Key.includes('..')) {
      throw new ForbiddenException({
        code: 'PATH_TRAVERSAL_ATTEMPT',
        message: 'Refusing to delete a key outside the invoices prefix',
      });
    }
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: s3Key }));
    await this.writeDeletionAudit(s3Key);
    this.logger.warn(`Deleted storage object ${s3Key}`);
  }

  private async writeDeletionAudit(s3Key: string): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          entityType: 'storage_object',
          entityId: this.deriveEntityId(s3Key),
          action: 'deleted',
          actorType: 'system',
          oldValueJson: { s3Key },
        },
      });
    } catch (error) {
      this.logger.error(`Failed to audit storage deletion ${s3Key}: ${(error as Error).message}`);
    }
  }

  /** audit_log.entityId is a uuid column; derive a stable uuid-shaped id. */
  private deriveEntityId(s3Key: string): string {
    const merchantSegment = s3Key.split('/')[1];
    if (merchantSegment && /^[0-9a-fA-F-]{36}$/.test(merchantSegment)) {
      return merchantSegment;
    }
    return '00000000-0000-0000-0000-000000000000';
  }

  /**
   * Reject any path segment that is not a simple, dot-bounded token. Blocks `/`,
   * `\`, `..`, leading dots and control characters — i.e. path traversal.
   */
  private safeSegment(value: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || value.includes('..')) {
      throw new Error(`Unsafe storage path segment: ${value}`);
    }
    return value;
  }
}
