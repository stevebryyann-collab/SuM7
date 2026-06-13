import { Global, Module } from '@nestjs/common';
import { EncryptionService } from './encryption.service';

/** Global field-encryption service for PII/secrets at rest. */
@Global()
@Module({
  providers: [EncryptionService],
  exports: [EncryptionService],
})
export class CryptoModule {}
