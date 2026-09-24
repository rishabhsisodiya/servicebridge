import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { ROTATION_GRACE_MS } from '../src/auth/sessions.service';
import { UsersService } from '../src/users/users.service';

/**
 * Full sign-in and user-management flow against a real, migrated Postgres.
 * Skipped unless TEST_DATABASE_URL is set (setup-int-env.ts points Prisma at it).
 * The database is emptied before the run: never point this at real data.
 */
const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const ORIGIN = 'http://localhost:3000';

/** Collects cookies from responses the way a browser would (name → value). */
class CookieJar {
  private cookies = new Map<string, string>();
  store(res: request.Response) {
    for (const line of ([] as string[]).concat(res.headers['set-cookie'] ?? [])) {
      const [pair] = line.split(';');
      const [name, value] = pair.split('=');
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
  }
  get(name: string) {
    return this.cookies.get(name);
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

run('auth and users (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer() as Server);
  const admin = new CookieJar();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe(
      'TRUNCATE "AuditLog", "UserToken", "Session", "User", "Region" RESTART IDENTITY CASCADE',
    );
    await app.get(UsersService).createActiveAdmin({
      email: 'admin@example.com',
      name: 'Test Admin',
      password: 'admin-password-1',
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('signs the admin in and sets the three cookies', async () => {
    const res = await api()
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'ADMIN@example.com', password: 'admin-password-1' })
      .expect(200);
    admin.store(res);
    expect(res.body.user).toMatchObject({ email: 'admin@example.com', role: 'ADMIN' });
    expect(admin.get('sb_access')).toBeDefined();
    expect(admin.get('sb_refresh')).toBeDefined();
    expect(admin.get('sb_signed_in')).toBe('1');
    const me = await api().get('/api/v1/auth/me').set('Cookie', admin.header()).expect(200);
    expect(me.body.permissions).toContain('users.manage');
  });

  it('rejects a wrong password without saying which part was wrong', async () => {
    const res = await api()
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'admin@example.com', password: 'nope-password-1' })
      .expect(401);
    expect(res.body.error.message).toBe('Email or password is incorrect.');
  });

  let inviteUrl: string;
  let engineerId: string;

  it('invites a user and returns a one-time link', async () => {
    const region = await api()
      .post('/api/v1/regions')
      .set('Cookie', admin.header())
      .set('Origin', ORIGIN)
      .send({ name: 'Central' })
      .expect(201);
    const res = await api()
      .post('/api/v1/users/invite')
      .set('Cookie', admin.header())
      .set('Origin', ORIGIN)
      .send({
        name: 'Kiran Shetty',
        email: 'kiran@example.com',
        role: 'ENGINEER',
        regionId: region.body.id,
      })
      .expect(201);
    expect(res.body.user).toMatchObject({ status: 'INVITED', region: { name: 'Central' } });
    inviteUrl = res.body.invite.url as string;
    engineerId = res.body.user.id as string;
    expect(inviteUrl).toMatch(/^http:\/\/localhost:3000\/welcome\/[A-Za-z0-9_-]{43}$/);

    const duplicate = await api()
      .post('/api/v1/users/invite')
      .set('Cookie', admin.header())
      .set('Origin', ORIGIN)
      .send({ name: 'Someone', email: 'KIRAN@example.com', role: 'ENGINEER' })
      .expect(409);
    expect(duplicate.body.error.code).toBe('EMAIL_TAKEN');
  });

  const engineer = new CookieJar();

  it('accepts the invite once, enforcing the password rules', async () => {
    const token = inviteUrl.split('/').pop()!;
    const info = await api().get(`/api/v1/auth/links/${token}`).expect(200);
    expect(info.body).toMatchObject({ type: 'INVITE', email: 'kiran@example.com' });

    const weak = await api()
      .post(`/api/v1/auth/links/${token}/accept`)
      .set('Origin', ORIGIN)
      .send({ password: 'short' })
      .expect(400);
    expect(weak.body.error.fields[0].field).toBe('password');

    const accepted = await api()
      .post(`/api/v1/auth/links/${token}/accept`)
      .set('Origin', ORIGIN)
      .send({ password: 'engineer-pass-1' })
      .expect(200);
    engineer.store(accepted);
    expect(accepted.body.user.status).toBe('ACTIVE');

    await api()
      .post(`/api/v1/auth/links/${token}/accept`)
      .set('Origin', ORIGIN)
      .send({ password: 'engineer-pass-2' })
      .expect(410);
  });

  it("doesn't let an engineer manage users", async () => {
    const res = await api().get('/api/v1/users').set('Cookie', engineer.header()).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rotates the refresh token and ends the session if an old one is replayed later', async () => {
    const original = engineer.get('sb_refresh')!;
    const refreshed = await api()
      .post('/api/v1/auth/refresh')
      .set('Cookie', `sb_refresh=${original}`)
      .set('Origin', ORIGIN)
      .expect(200);
    engineer.store(refreshed);
    expect(engineer.get('sb_refresh')).not.toBe(original);

    // Simulate the grace window passing, then replay the stolen/old token.
    await prisma.session.updateMany({
      where: { userId: engineerId },
      data: { rotatedAt: new Date(Date.now() - ROTATION_GRACE_MS - 1_000) },
    });
    await api()
      .post('/api/v1/auth/refresh')
      .set('Cookie', `sb_refresh=${original}`)
      .set('Origin', ORIGIN)
      .expect(401);
    // The legitimate holder is signed out too: the session is gone.
    await api().get('/api/v1/auth/me').set('Cookie', engineer.header()).expect(401);
  });

  it('requires a fresh password check before issuing a reset link', async () => {
    const blocked = await api()
      .post(`/api/v1/users/${engineerId}/reset-link`)
      .set('Cookie', admin.header())
      .set('Origin', ORIGIN)
      .expect(403);
    expect(blocked.body.error.code).toBe('STEP_UP_REQUIRED');

    await api()
      .post('/api/v1/auth/confirm-password')
      .set('Cookie', admin.header())
      .set('Origin', ORIGIN)
      .send({ password: 'admin-password-1' })
      .expect(204);
    const link = await api()
      .post(`/api/v1/users/${engineerId}/reset-link`)
      .set('Cookie', admin.header())
      .set('Origin', ORIGIN)
      .expect(201);
    expect(link.body.url).toMatch(/\/reset-password\//);
  });

  it('protects the last administrator and audits every change', async () => {
    const me = await api().get('/api/v1/auth/me').set('Cookie', admin.header()).expect(200);
    const self = await api()
      .post(`/api/v1/users/${me.body.user.id}/deactivate`)
      .set('Cookie', admin.header())
      .set('Origin', ORIGIN)
      .expect(409);
    expect(self.body.error.code).toBe('OWN_ACCOUNT');

    await api()
      .post(`/api/v1/users/${engineerId}/deactivate`)
      .set('Cookie', admin.header())
      .set('Origin', ORIGIN)
      .expect(201);

    const actions = (await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        'user.admin_created',
        'auth.signed_in',
        'user.invited',
        'user.invite_accepted',
        'user.reset_link_issued',
        'user.deactivated',
      ]),
    );
  });

  it('signs out and clears cookies', async () => {
    const res = await api()
      .post('/api/v1/auth/logout')
      .set('Cookie', admin.header())
      .set('Origin', ORIGIN)
      .expect(204);
    admin.store(res);
    expect(admin.get('sb_signed_in')).toBeUndefined();
  });
});
