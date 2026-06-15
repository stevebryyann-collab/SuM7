import {
  BadRequestException,
  Controller,
  HttpCode,
  Logger,
  Post,
  Req,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import { Webhook } from 'svix';
import type { Request } from 'express';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { MerchantContextService } from '../prisma/merchant-context.service';

/** Minimal shape of the Clerk webhook payloads we act on. */
interface ClerkEmailAddress {
  email_address: string;
  verification?: { status?: string | null } | null;
}
interface ClerkEventData {
  id: string;
  email_addresses?: ClerkEmailAddress[];
}
interface ClerkWebhookEvent {
  type: string;
  data: ClerkEventData;
}

/**
 * Clerk → platform synchronization webhook.
 *
 * The Svix signature is verified against CLERK_WEBHOOK_SECRET BEFORE any
 * processing. This route is exempt from rate limiting (the RateLimitGuard skips
 * `/webhooks/*`) and is not bound to a validated DTO, so the global
 * ValidationPipe never touches the raw body Svix needs.
 *
 * Clerk owns BUYER identity only — merchants authenticate via NextAuth + Shopify
 * OAuth, so there is no organization sync here. `user.created` links the Clerk
 * user id to the buyer record; `user.updated` mirrors Clerk's verified-email
 * state into `buyers.emailVerifiedAt`.
 */
@Controller('webhooks/clerk')
export class ClerkWebhooksController {
  private readonly logger = new Logger(ClerkWebhooksController.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
    private readonly merchantContext: MerchantContextService,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(@Req() req: RawBodyRequest<Request>): Promise<{ received: true }> {
    const raw = req.rawBody;
    if (!raw) {
      throw new BadRequestException({ code: 'MISSING_RAW_BODY', message: 'Raw body unavailable' });
    }

    const svixId = req.headers['svix-id'];
    const svixTimestamp = req.headers['svix-timestamp'];
    const svixSignature = req.headers['svix-signature'];
    if (
      typeof svixId !== 'string' ||
      typeof svixTimestamp !== 'string' ||
      typeof svixSignature !== 'string'
    ) {
      throw new UnauthorizedException({
        code: 'MISSING_SVIX_HEADERS',
        message: 'Missing Svix signature headers',
      });
    }

    let event: ClerkWebhookEvent;
    try {
      const wh = new Webhook(this.config.get('CLERK_WEBHOOK_SECRET'));
      event = wh.verify(raw.toString('utf8'), {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
      }) as ClerkWebhookEvent;
    } catch {
      throw new UnauthorizedException({
        code: 'INVALID_SIGNATURE',
        message: 'Svix signature verification failed',
      });
    }

    switch (event.type) {
      case 'user.created':
        await this.onUserCreated(event.data);
        break;
      case 'user.updated':
        await this.onUserUpdated(event.data);
        break;
      case 'user.deleted':
        // GDPR erasure runs via our own pipeline (merchant-purge-data worker);
        // here we only record receipt.
        this.logger.log(`Clerk user.deleted ${event.data.id} — erasure handled separately`);
        break;
      default:
        this.logger.debug(`Unhandled Clerk event: ${event.type}`);
    }

    return { received: true };
  }

  /** Link a newly-created Clerk user to its buyer account by email. */
  private async onUserCreated(data: ClerkEventData): Promise<void> {
    const email = data.email_addresses?.[0]?.email_address;
    if (!email) {
      this.logger.warn(`user.created ${data.id} has no email address; cannot link buyer`);
      return;
    }
    const result = await this.merchantContext.runAsSystem(() =>
      this.prisma.buyer.updateMany({
        where: { email },
        data: { clerkUserId: data.id },
      }),
    );
    this.logger.log(`Linked Clerk user ${data.id} to ${result.count} buyer(s) (${email})`);
  }

  /**
   * Mirror Clerk's verified-email status into `buyers.emailVerifiedAt`. Sets the
   * timestamp only when the primary email is verified AND the column is still
   * null — an existing verification timestamp is never overwritten.
   */
  private async onUserUpdated(data: ClerkEventData): Promise<void> {
    const verified = data.email_addresses?.[0]?.verification?.status === 'verified';
    if (!verified) {
      return;
    }
    const result = await this.merchantContext.runAsSystem(() =>
      this.prisma.buyer.updateMany({
        where: { clerkUserId: data.id, emailVerifiedAt: null },
        data: { emailVerifiedAt: new Date() },
      }),
    );
    if (result.count > 0) {
      this.logger.log(`Marked email verified for buyer linked to Clerk user ${data.id}`);
    }
  }
}
