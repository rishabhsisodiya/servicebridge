import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import { AppConfig } from './core/config/app-config.service';
import { AllExceptionsFilter } from './core/http/all-exceptions.filter';
import { createValidationPipe } from './core/http/validation.pipe';

export const API_PREFIX = 'api/v1';

/** Global HTTP setup, shared by main.ts and the e2e tests. */
export function configureApp(app: INestApplication): void {
  const config = app.get(AppConfig);

  app.setGlobalPrefix(API_PREFIX);
  app.use(helmet());
  app.enableCors({
    origin: config.get('CORS_ORIGINS'),
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
}
