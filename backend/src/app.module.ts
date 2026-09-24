import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
import { AppConfigModule } from './core/config/config.module';
import { CoreModule } from './core/core.module';
import { ErpModule } from './erp/erp.module';
import { AppConfig } from './core/config/app-config.service';
import { HealthModule } from './core/health/health.module';
import { buildLoggerParams } from './core/logging/logging.config';
import { PrismaModule } from './core/prisma/prisma.module';
import { RedisModule } from './core/redis/redis.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        buildLoggerParams({
          NODE_ENV: config.get('NODE_ENV'),
          LOG_LEVEL: config.get('LOG_LEVEL'),
        }),
    }),
    PrismaModule,
    RedisModule,
    CoreModule,
    HealthModule,
    AuthModule,
    ErpModule,
  ],
})
export class AppModule {}
