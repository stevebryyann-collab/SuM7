import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import {
  MerchantSessionGuard,
  type MerchantAuthenticatedRequest,
} from '../auth/guards/merchant-session.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DashboardService, type DashboardData } from './dashboard.service';

/**
 * Merchant dashboard aggregator. A single `GET /api/v1/dashboard` returns the
 * KPI cards, AR-aging buckets, 30-day GMV trend, the 10 most recent invoices,
 * pending applications and the onboarding-checklist flags so the dashboard page
 * makes one request. The merchantId is taken from the verified session.
 */
@Controller('api/v1')
@UseGuards(MerchantSessionGuard, RolesGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('dashboard')
  getDashboard(@Req() req: MerchantAuthenticatedRequest): Promise<DashboardData> {
    return this.dashboard.getDashboard(req.merchant!.merchantId);
  }
}
