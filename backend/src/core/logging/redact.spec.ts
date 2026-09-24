import { stripUrlCredentials } from './redact';

describe('stripUrlCredentials', () => {
  it.each([
    ['connect ECONNREFUSED postgres://sb:secret@db:5432', 'postgres://[redacted]@db:5432'],
    ['redis://:p4ss@cache:6379 refused', 'redis://[redacted]@cache:6379 refused'],
    ['mysql://readonly:pw@10.0.0.4/erp', 'mysql://[redacted]@10.0.0.4/erp'],
  ])('redacts %p', (input, expected) => {
    expect(stripUrlCredentials(input)).toContain(expected);
    expect(stripUrlCredentials(input)).not.toMatch(/secret|p4ss|:pw@/);
  });

  it('leaves URLs without credentials alone', () => {
    expect(stripUrlCredentials('GET https://erp.example.com/api/resource')).toBe(
      'GET https://erp.example.com/api/resource',
    );
  });
});
