import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { API_PREFIX, configureApp } from './bootstrap';
import { AppConfig } from './core/config/app-config.service';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);

  const port = app.get(AppConfig).get('PORT');
  await app.listen(port);
  app.get(Logger).log(`ServiceBridge API listening on http://localhost:${port}/${API_PREFIX}`);
}

void main();
