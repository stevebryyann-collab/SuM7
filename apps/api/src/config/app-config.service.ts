import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from './env.validation';

/**
 * Type-safe wrapper over Nest's ConfigService. Every key is validated at boot by
 * the Joi schema, so `getOrThrow` here is total — it never returns undefined for
 * a required key.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.config.getOrThrow(key, { infer: true });
  }

  get isProduction(): boolean {
    return this.get('NODE_ENV') === 'production';
  }

  get isDevelopment(): boolean {
    return this.get('NODE_ENV') === 'development';
  }

  /** Parsed list of allowed CORS origins. */
  get allowedOrigins(): string[] {
    return this.get('ALLOWED_ORIGINS')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
  }
}
