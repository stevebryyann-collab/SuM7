import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { MerchantContextService } from './merchant-context.service';

/**
 * Global database access. Exports both the Prisma client wrapper and the
 * AsyncLocalStorage-backed tenant context that drives Row-Level Security.
 */
@Global()
@Module({
  providers: [PrismaService, MerchantContextService],
  exports: [PrismaService, MerchantContextService],
})
export class PrismaModule {}
