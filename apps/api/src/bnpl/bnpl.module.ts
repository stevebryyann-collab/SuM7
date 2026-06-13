import { Module } from '@nestjs/common';

/**
 * B2B BNPL via Resolve (US, Phase 1), always behind an adapter interface so
 * business logic never touches the Resolve SDK directly. Bootable scaffold —
 * the Resolve adapter + webhook handling are added by the BNPL feature task.
 */
@Module({})
export class BnplModule {}
