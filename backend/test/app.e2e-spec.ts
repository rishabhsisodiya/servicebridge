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

  describe('auth boundaries', () => {
    it('requires sign-in for everything that is not marked public', async () => {
      const res = await api().get('/api/v1/users').expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects a forged access cookie', async () => {
      const res = await api()
        .get('/api/v1/auth/me')
        .set('Cookie', 'sb_access=not-a-jwt')
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('blocks state-changing requests from other sites', async () => {
      const res = await api()
        .post('/api/v1/auth/login')
        .set('Origin', 'https://evil.example')
        .send({ email: 'a@b.co', password: 'x' })
        .expect(403);
      expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    });

    it('validates the login form with field-level messages', async () => {
      const res = await api()
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:3000')
        .send({ email: 'not-an-email', password: '', extra: 'field' })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      const fields = (res.body.error.fields as { field: string }[]).map((f) => f.field);
      expect(fields).toEqual(expect.arrayContaining(['email', 'password', 'extra']));
    });

    it('clears auth cookies when a refresh fails, so the sign-in page cannot loop', async () => {
      const res = await api().post('/api/v1/auth/refresh').expect(401);
      expect(res.body.error.code).toBe('SESSION_ENDED');
      const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
      expect(cookies.some((c) => c.startsWith('sb_signed_in=;'))).toBe(true);
      expect(cookies.some((c) => c.startsWith('sb_access=;'))).toBe(true);
    });

    it('keeps health checks public', async () => {
      await api().get('/api/v1/health/live').expect(200);
    });
  });
});
