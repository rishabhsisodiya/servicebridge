import { Reflector } from '@nestjs/core';
import { IS_PUBLIC } from '../auth/decorators';
import { PortalAmcController } from './portal-amc.controller';
import { PortalAuthController } from './portal-auth.controller';
import { PortalQuotationsController } from './portal-quotations.controller';
import { PortalStaffController } from './portal-staff.controller';
import { PortalTicketsController } from './portal-tickets.controller';

/**
 * Guard-wiring regression test. The staff AuthGuard is global: it 401s every
 * route that isn't @Public(). Portal data routes authenticate customers via
 * PortalGuard instead, so each one must be @Public() — otherwise a signed-in
 * customer gets "Sign in to continue." on every portal screen. The staff-only
 * route (PortalStaffController) must NOT be public.
 *
 * Mirrors AuthGuard.canActivate: reflector.getAllAndOverride(IS_PUBLIC,
 * [handler, controllerClass]).
 */
describe('portal guard wiring', () => {
  const reflector = new Reflector();
  const routesOf = (controller: new (...args: never[]) => object) => {
    const prototype = controller.prototype as Record<string, unknown>;
    return Object.getOwnPropertyNames(prototype)
      .filter((name) => name !== 'constructor' && typeof prototype[name] === 'function')
      .map((name) => prototype[name] as (...args: never[]) => unknown);
  };

  it.each([
    ['PortalAuthController', PortalAuthController],
    ['PortalTicketsController', PortalTicketsController],
    ['PortalQuotationsController', PortalQuotationsController],
    ['PortalAmcController', PortalAmcController],
  ] as const)('%s marks every route @Public()', (_name, controller) => {
    const routes = routesOf(controller);
    expect(routes.length).toBeGreaterThan(0);
    for (const handler of routes) {
      expect(reflector.getAllAndOverride<boolean>(IS_PUBLIC, [handler, controller])).toBe(true);
    }
  });

  it('PortalStaffController stays staff-guarded (not @Public())', () => {
    for (const handler of routesOf(PortalStaffController)) {
      expect(
        reflector.getAllAndOverride<boolean>(IS_PUBLIC, [handler, PortalStaffController]),
      ).not.toBe(true);
    }
  });
});
