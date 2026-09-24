import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { REDIS } from '../src/core/redis/redis.module';

// Boots the real app with its real global setup; only Postgres and Redis are
// replaced, so these tests need no infrastructure. Env comes from setup-env.ts.

describe('ServiceBridge API (e2e)', () => {
  let app: INestApplication;
  const db = { $queryRaw: jest.fn(), $disconnect: jest.fn() };
  const redis = { ping: jest.fn(), status: 'end' };
  const api = () => request(app.getHttpServer() as Server);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideProvider(REDIS)
      .useValue(redis)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    db.$queryRaw.mockResolvedValue([{ ok: 1 }]);
    redis.ping.mockResolvedValue('PONG');
  });

  it('GET /health/live answers without touching dependencies', async () => {
    db.$queryRaw.mockRejectedValue(new Error('down'));
    const res = await api().get('/api/v1/health/live').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('GET /health/ready is 200 when Postgres and Redis answer', async () => {
    const res = await api().get('/api/v1/health/ready').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /health/ready is 503 and names the failing dependency', async () => {
    redis.ping.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await api().get('/api/v1/health/ready').expect(503);
    expect(res.body.checks.redis.status).toBe('down');
    expect(res.body.checks.database.status).toBe('up');
  });

  it('returns the standard error body for unknown routes', async () => {
    const res = await api().get('/api/v1/nope').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('sends security headers and allows only configured origins', async () => {
    const allowed = await api().get('/api/v1/health/live').set('Origin', 'http://localhost:3000');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(allowed.headers['x-content-type-options']).toBe('nosniff');

    const blocked = await api().get('/api/v1/health/live').set('Origin', 'https://evil.example');
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });
});
