import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ResolveAdapter } from './adapters/resolve.adapter';
import type {
  BnplAdapter,
  EligibilityParams,
  EligibilityResult,
  FinancingParams,
  FinancingResult,
} from './bnpl.interfaces';

/** A safe, structured BNPL error. `userMessage` is the only buyer-facing text. */
export class BnplException extends HttpException {
  constructor(detail: { code: string; userMessage: string }, status: HttpStatus = HttpStatus.BAD_GATEWAY) {
    super({ code: detail.code, message: detail.userMessage }, status);
  }
}

/**
 * BNPL façade. Selects the provider adapter for a merchant (always Resolve in
 * Phase 1; the seam exists for future per-region routing) and delegates,
 * translating any adapter/transport failure into a {@link BnplException} so raw
 * provider errors never reach the buyer.
 */
@Injectable()
export class BnplService {
  private readonly logger = new Logger(BnplService.name);

  constructor(private readonly resolve: ResolveAdapter) {}

  /** Resolve the adapter for a merchant. Phase 1: always Resolve. */
  getAdapter(_merchantId: string): BnplAdapter {
    return this.resolve;
  }

  async checkEligibility(merchantId: string, params: EligibilityParams): Promise<EligibilityResult> {
    try {
      return await this.getAdapter(merchantId).checkEligibility(params);
    } catch (error) {
      this.logger.error(`BNPL eligibility failed: ${(error as Error).message}`);
      throw new BnplException({
        code: 'BNPL_ELIGIBILITY_UNAVAILABLE',
        userMessage: 'Financing options are temporarily unavailable. Please try again later.',
      });
    }
  }

  async initiateFinancing(merchantId: string, params: FinancingParams): Promise<FinancingResult> {
    try {
      return await this.getAdapter(merchantId).initiateFinancing(params);
    } catch (error) {
      this.logger.error(`BNPL financing initiation failed: ${(error as Error).message}`);
      throw new BnplException({
        code: 'BNPL_INITIATION_FAILED',
        userMessage: 'We could not start financing for this order. Please try again later.',
      });
    }
  }
}
