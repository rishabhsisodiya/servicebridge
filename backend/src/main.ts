import 'reflect-metadata';
import type { Server } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { API_PREFIX, configureApp } from './bootstrap';
import { AppConfig } from './core/config/app-config.service';

const KEEP_ALIVE_MS = 65_000;

async function main(): Promise<void> {
  // rawBody: webhook signatures are computed over the exact bytes ERPNext sent.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));
  configureApp(app);

  // The web app's proxy keeps connections to this API open for reuse. Node closes
  // idle sockets after 5 s by default, which races with reuse and surfaces as
  // ECONNRESET; keep them open longer than any upstream proxy's idle timeout.
  const server = app.getHttpServer() as Server;
  server.keepAliveTimeout = KEEP_ALIVE_MS;
  server.headersTimeout = KEEP_ALIVE_MS + 1_000;

  const port = app.get(AppConfig).get('PORT');
  await app.listen(port);
  app.get(Logger).log(`ERPTick API listening on http://localhost:${port}/${API_PREFIX}`);
}

void main();
