import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * Global S3 storage (SSE-KMS, presigned downloads). Injected by the invoice
 * workers and any future document-handling feature. Depends on the global
 * CircuitBreaker and Config modules.
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
