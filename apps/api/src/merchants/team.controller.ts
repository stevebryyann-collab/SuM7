import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  InviteTeamMemberSchema,
  UpdateTeamMemberSchema,
  type InviteTeamMemberInput,
  type UpdateTeamMemberInput,
} from '@b2b/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  MerchantSessionGuard,
  type MerchantAuthenticatedRequest,
} from '../auth/guards/merchant-session.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MerchantsService, type TeamMember } from './merchants.service';

/**
 * Team management (`/api/v1/team`) — owner only. Lists staff users, changes a
 * non-owner member's role, and removes members. Invitations are a v1 stub: the
 * UI is built but no email is sent and no user is provisioned (Clerk owns user
 * identity), so the endpoint acknowledges with a coming-soon flag.
 */
@Controller('api/v1/team')
@UseGuards(MerchantSessionGuard, RolesGuard)
@Roles('owner')
export class TeamController {
  constructor(private readonly merchants: MerchantsService) {}

  @Get()
  listTeam(@Req() req: MerchantAuthenticatedRequest): Promise<TeamMember[]> {
    return this.merchants.listTeam(req.merchant!.merchantId);
  }

  @Patch(':id')
  changeRole(
    @Req() req: MerchantAuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(new ZodValidationPipe(UpdateTeamMemberSchema)) dto: UpdateTeamMemberInput,
  ): Promise<TeamMember> {
    return this.merchants.changeTeamRole(req.merchant!.merchantId, id, dto.role, req.merchant!.userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @Req() req: MerchantAuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<void> {
    await this.merchants.removeTeamMember(req.merchant!.merchantId, id, req.merchant!.userId);
  }

  @Post('invite')
  @HttpCode(HttpStatus.ACCEPTED)
  invite(
    @Body(new ZodValidationPipe(InviteTeamMemberSchema)) dto: InviteTeamMemberInput,
  ): { invited: false; comingSoon: true; email: string } {
    // v1 stub — invitations are not yet wired (see controller docblock).
    return { invited: false, comingSoon: true, email: dto.email };
  }
}
