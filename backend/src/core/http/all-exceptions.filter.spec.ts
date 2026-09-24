import { type ArgumentsHost, HttpStatus, Logger, NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { AppException, validationFailed } from './app.exception';

function run(exception: unknown) {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ id: 'req-12345678', url: '/x' }),
      getResponse: () => res,
    }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return { status: res.status.mock.calls[0][0] as number, body: res.json.mock.calls[0][0] };
}

describe('AllExceptionsFilter', () => {
  it('passes AppException code, message and fields through', () => {
    const { status, body } = run(
      new AppException('CONNECTION_IN_USE', 'Disable the connection first.', HttpStatus.CONFLICT),
    );
    expect(status).toBe(409);
    expect(body).toEqual({
      error: {
        code: 'CONNECTION_IN_USE',
        message: 'Disable the connection first.',
        requestId: 'req-12345678',
      },
    });
  });

  it('includes field errors for validation failures', () => {
    const { status, body } = run(
      validationFailed([{ field: 'baseUrl', message: 'must be https' }]),
    );
    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.fields).toEqual([{ field: 'baseUrl', message: 'must be https' }]);
  });

  it('maps Nest HTTP exceptions to stable codes', () => {
    const { status, body } = run(new NotFoundException('Ticket not found'));
    expect(status).toBe(404);
    expect(body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Ticket not found' });
  });

  it('hides the details of unexpected errors but logs them without credentials', () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { status, body } = run(new Error('connect failed postgres://sb:secret@db/x'));
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).not.toContain('connect failed');
    const log = JSON.stringify(logged.mock.calls);
    expect(log).toContain('connect failed');
    expect(log).not.toContain('secret');
    logged.mockRestore();
  });
});
