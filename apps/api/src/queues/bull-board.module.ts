import { Module } from '@nestjs/common';
import { BullBoardModule } from '@bull-board/nestjs';
import { ExpressAdapter } from '@bull-board/express';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { verifyToken } from '@clerk/backend';
import type { NextFunction, Request, Response } from 'express';
import { ALL_QUEUES } from './queue.module';

/** Clerk org role that maps to the merchant "owner" privilege. */
const OWNER_ROLE = 'org:admin';

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return null;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token.trim();
}

/**
 * Gate for the Bull Board UI: requires a valid Clerk org session whose role is
 * the merchant owner. Applied as middleware ahead of the board router, so the
 * dashboard is never publicly reachable.
 */
async function requireMerchantOwner(req: Request, res: Response, next: NextFunction): Promise<void> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    res.status(500).json({ code: 'CONFIG_ERROR', message: 'Auth not configured' });
    return;
  }
  const token = bearer(req);
  if (!token) {
    res.status(401).json({ code: 'MISSING_TOKEN', message: 'Authentication required' });
    return;
  }
  try {
    const payload = await verifyToken(token, { secretKey });
    if (typeof payload.org_id !== 'string' || payload.org_id.length === 0) {
      res.status(403).json({ code: 'NO_ORG_CONTEXT', message: 'Organization context required' });
      return;
    }
    if (payload.org_role !== OWNER_ROLE) {
      res.status(403).json({ code: 'FORBIDDEN', message: 'Owner role required' });
      return;
    }
  } catch {
    res.status(401).json({ code: 'INVALID_TOKEN', message: 'Invalid or expired token' });
    return;
  }
  next();
}

/**
 * Mounts the Bull Board dashboard at /internal/queues for every registered
 * queue. Not publicly exposed — gated by {@link requireMerchantOwner} (Clerk
 * org session + owner role).
 */
@Module({
  imports: [
    BullBoardModule.forRoot({
      route: '/internal/queues',
      adapter: ExpressAdapter,
      middleware: requireMerchantOwner,
    }),
    BullBoardModule.forFeature(
      ...ALL_QUEUES.map((name) => ({ name, adapter: BullMQAdapter })),
    ),
  ],
})
export class BullBoardConfigModule {}
