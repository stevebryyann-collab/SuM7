import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type CircuitBreaker from 'opossum';
import { AppConfigService } from '../config/app-config.service';
import { CircuitBreakerFactory } from '../common/circuit-breaker/circuit-breaker.factory';

export interface UploadInvoiceParams {
  merchantId: string;
  invoiceNumber: string;
  body: Buffer;
  contentType?: string;
}

export interface UploadResult {
  key: string;
}

const DEFAULT_PRESIGN_TTL_SECONDS = 900;

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
   * Upload an invoice PDF under `invoices/{merchantId}/{invoiceNumber}.pdf`,
   * encrypted with SSE-KMS. Both path segments are validated so a malicious
   * invoice number can never escape the prefix.
   */
  async uploadInvoice(params: UploadInvoiceParams): Promise<UploadResult> {
    const merchant = this.safeSegment(params.merchantId);
    const invoice = this.safeSegment(params.invoiceNumber);
    const key = `invoices/${merchant}/${invoice}.pdf`;

    await this.putBreaker.fire({
      Bucket: this.bucket,
      Key: key,
      Body: params.body,
      ContentType: params.contentType ?? 'application/pdf',
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: this.kmsKeyArn,
    });

    this.logger.log(`Uploaded invoice object ${key} (${params.body.length} bytes)`);
    return { key };
  }

  /** Generate a short-lived presigned GET URL for a stored object. */
  async presignDownload(key: string, ttlSeconds = DEFAULT_PRESIGN_TTL_SECONDS): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.s3, command, { expiresIn: ttlSeconds });
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
