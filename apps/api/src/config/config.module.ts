import { Global, Module } from '@nestjs/common';
import { AppConfigService } from './app-config.service';

/**
 * Exposes the typed {@link AppConfigService} globally. The underlying
 * ConfigModule.forRoot (with the Joi schema) is registered in AppModule.
 */
@Global()
@Module({
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
