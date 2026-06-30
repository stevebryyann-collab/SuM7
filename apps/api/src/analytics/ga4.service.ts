import { Injectable, Inject, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';

export interface GA4Event {
  name: string;
  params: Record<string, any>;
}

export interface GA4Config {
  measurementId: string;
  apiSecret: string;
}

@Injectable()
export class Ga4Service {
  private readonly logger = new Logger(Ga4Service.name);
  private readonly GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

  constructor(
    @Inject('REDIS_CACHE') private readonly cache: Redis,
    private readonly prisma: PrismaService,
  ) {}

  async trackEvent(
    merchantId: string,
    clientId: string,
    event: GA4Event,
    correlationId?: string,
  ): Promise<void> {
    const config = await this.getGA4Config(merchantId);
    if (!config) {
      // Merchant hasn't configured GA4, skip silently
      return;
    }

    const payload = {
      client_id: clientId,
      events: [
        {
          name: event.name,
          params: {
            ...event.params,
            merchant_id: merchantId,
          },
        },
      ],
    };

    try {
      const url = `${this.GA4_ENDPOINT}?measurement_id=${config.measurementId}&api_secret=${config.apiSecret}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        this.logger.warn('GA4 event tracking failed', {
          merchantId,
          event: event.name,
          status: response.status,
          correlationId,
        });
      }
    } catch (error) {
      this.logger.error('GA4 event tracking error', { merchantId, event: event.name, error, correlationId });
    }
  }

  async trackOrderPlaced(
    merchantId: string,
    clientId: string,
    orderId: string,
    value: number,
    currency: string,
    items: Array<{ item_id: string; item_name: string; quantity: number; price: number }>,
  ): Promise<void> {
    await this.trackEvent(merchantId, clientId, {
      name: 'purchase',
      params: {
        transaction_id: orderId,
        value,
        currency,
        items,
      },
    });
  }

  async trackViewItem(
    merchantId: string,
    clientId: string,
    itemId: string,
    itemName: string,
    value: number,
    currency: string,
  ): Promise<void> {
    await this.trackEvent(merchantId, clientId, {
      name: 'view_item',
      params: {
        currency,
        value,
        items: [{ item_id: itemId, item_name: itemName, quantity: 1, price: value }],
      },
    });
  }

  async trackAddToCart(
    merchantId: string,
    clientId: string,
    itemId: string,
    itemName: string,
    quantity: number,
    price: number,
    currency: string,
  ): Promise<void> {
    await this.trackEvent(merchantId, clientId, {
      name: 'add_to_cart',
      params: {
        currency,
        value: price * quantity,
        items: [{ item_id: itemId, item_name: itemName, quantity, price }],
      },
    });
  }

  async trackBeginCheckout(
    merchantId: string,
    clientId: string,
    value: number,
    currency: string,
    items: Array<{ item_id: string; item_name: string; quantity: number; price: number }>,
  ): Promise<void> {
    await this.trackEvent(merchantId, clientId, {
      name: 'begin_checkout',
      params: {
        currency,
        value,
        items,
      },
    });
  }

  private async getGA4Config(merchantId: string): Promise<GA4Config | null> {
    const cacheKey = `ga4:config:${merchantId}`;
    const cached = await this.cache.get(cacheKey);

    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // Fall through to DB
      }
    }

    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { ga4Id: true },
    });

    if (!merchant?.ga4Id) {
      // Cache negative result for 5 minutes
      await this.cache.setex(cacheKey, 300, 'null');
      return null;
    }

    // Parse GA4 measurement ID and API secret from merchant config
    // Format expected: "G-XXXXXXXXXX|api_secret"
    const parts = merchant.ga4Id.split('|');
    if (parts.length !== 2) {
      this.logger.warn('Invalid GA4 config format', { merchantId, ga4Id: merchant.ga4Id });
      return null;
    }

    const config: GA4Config = {
      measurementId: parts[0]!,
      apiSecret: parts[1]!,
    };

    await this.cache.setex(cacheKey, 3600, JSON.stringify(config));
    return config;
  }

  async invalidateGA4Cache(merchantId: string): Promise<void> {
    await this.cache.del(`ga4:config:${merchantId}`);
  }
}
