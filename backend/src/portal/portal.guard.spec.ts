import { PortalGuard } from './portal.guard';

const contextFor = (cookies: Record<string, string> | undefined, ip = '10.0.0.1') => {
  const request = { cookies, ip };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as never;
};

const makeGuard = (validateSession: jest.Mock = jest.fn()) => {
  const auth = { validateSession };
  const rateLimit = { enforce: jest.fn().mockResolvedValue(undefined) };
  const guard = new PortalGuard(auth as never, rateLimit as never);
  return { guard, auth, rateLimit };
};

describe('PortalGuard', () => {
  it('attaches the customer identity for a valid session cookie', async () => {
    const identity = { contactId: 'c1', customerId: 'cust1', contactName: 'A', email: 'a@x.com' };
    const { guard, rateLimit } = makeGuard(jest.fn().mockResolvedValue(identity));
    const context = contextFor({ sb_portal_access: 'tok' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(rateLimit.enforce).toHaveBeenCalledWith('portal:ip:10.0.0.1', 600, 60);
    const request = (context as { switchToHttp: () => { getRequest: () => { customer: unknown } } })
      .switchToHttp()
      .getRequest();
    expect(request.customer).toEqual(identity);
  });

  it('throws 401 when the cookie is missing or the session is invalid', async () => {
    const { guard } = makeGuard();
    await expect(guard.canActivate(contextFor(undefined))).rejects.toMatchObject({
      code: 'PORTAL_UNAUTHENTICATED',
      status: 401,
    });
    const invalid = makeGuard(jest.fn().mockResolvedValue(null));
    await expect(
      invalid.guard.canActivate(contextFor({ sb_portal_access: 'bad' })),
    ).rejects.toMatchObject({ code: 'PORTAL_UNAUTHENTICATED', status: 401 });
  });
});
