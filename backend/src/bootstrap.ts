import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppConfig } from './core/config/app-config.service';
import { AllExceptionsFilter } from './core/http/all-exceptions.filter';
import { createValidationPipe } from './core/http/validation.pipe';

export const API_PREFIX = 'api/v1';

/** Global HTTP setup, shared by main.ts and the e2e tests. */
export function configureApp(app: INestApplication): void {
  const config = app.get(AppConfig);

  // The web app's proxy (and any load balancer on a private network) sits in
  // front of the API; trust its X-Forwarded-For so req.ip is the browser's address.
  (app as NestExpressApplication).set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.use(cookieParser());

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
