import {
  assertHostAllowed,
  isPrivateAddress,
  normaliseBaseUrl,
  resolveSafeAddress,
} from './network-guard';

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    'not-an-ip',
  ])('blocks %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '172.32.0.1', '104.21.1.1', '2606:4700::1111'])('allows public %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });

  describe('SB-H4: hex-form IPv4-embedded IPv6', () => {
    it.each([
      '::ffff:7f00:1', // WHATWG serialization of ::ffff:127.0.0.1
      '::ffff:7F00:0001', // case and zero-padding variants
      '::ffff:c0a8:1', // 192.168.0.1
      '::ffff:a9fe:a9fe', // 169.254.169.254 (cloud metadata)
      '::ffff:0:7f00:1', // IPv4-translated form of ::ffff:127.0.0.1 (RFC 4291)
      '::ffff:0:a9fe:a9fe', // IPv4-translated form of 169.254.169.254
      '2002:7f00:1::', // 6to4 wrapping 127.0.0.1
      '2002:c0a8:100::1', // 6to4 wrapping 192.168.1.0
    ])('blocks %s', (ip) => {
      expect(isPrivateAddress(ip)).toBe(true);
    });

    it.each([
      '::ffff:808:808', // 8.8.8.8 — public stays public
      '::ffff:0:808:808', // translated form of public 8.8.8.8 stays public
      '2002:808:808::', // 6to4 wrapping 8.8.8.8
    ])('allows public %s', (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    });

    it('blocks the WHATWG-normalized form end to end via assertHostAllowed', () => {
      const host = new URL('https://[::ffff:127.0.0.1]:8443').hostname.replace(/^\[|\]$/g, '');
      expect(host).toBe('::ffff:7f00:1');
      expect(() => assertHostAllowed(host, false)).toThrow(/private or reserved/);
    });

    it('blocks the IPv4-translated form end to end via assertHostAllowed', () => {
      const host = new URL('https://[::ffff:0:127.0.0.1]:8443').hostname.replace(/^\[|\]$/g, '');
      expect(host).toBe('::ffff:0:7f00:1');
      expect(() => assertHostAllowed(host, false)).toThrow(/private or reserved/);
    });
  });
});

describe('resolveSafeAddress', () => {
  it('refuses a name that resolves to loopback unless private hosts are allowed', async () => {
    await expect(resolveSafeAddress('localhost', false)).rejects.toMatchObject({
      code: 'EBLOCKEDADDRESS',
    });
    await expect(resolveSafeAddress('localhost', true)).resolves.toMatch(/^(127\.0\.0\.1|::1)$/);
  });
});

describe('normaliseBaseUrl', () => {
  const strict = { allowHttp: false };

  it('keeps only the origin', () => {
    expect(normaliseBaseUrl(' https://erp.example.com/ ', strict)).toEqual({
      url: 'https://erp.example.com',
    });
    expect(normaliseBaseUrl('https://erp.example.com:8443', strict)).toEqual({
      url: 'https://erp.example.com:8443',
    });
  });

  it.each([
    ['erp.example.com', /full address/],
    ['http://erp.example.com', /https:\/\//],
    ['https://user:pw@erp.example.com', /username or password/],
    ['https://erp.example.com/app/home', /without a path/],
    ['https://erp.example.com?x=1', /without a path/],
    ['ftp://erp.example.com', /https:\/\//],
  ])('rejects %p', (input, problem) => {
    expect(normaliseBaseUrl(input, strict).problem).toMatch(problem);
  });

  it('allows http only when configured (development)', () => {
    expect(normaliseBaseUrl('http://localhost:8000', { allowHttp: true })).toEqual({
      url: 'http://localhost:8000',
    });
  });
});

describe('assertHostAllowed', () => {
  it('blocks private IP literals, which never go through DNS lookup', () => {
    expect(() => assertHostAllowed('169.254.169.254', false)).toThrow(/private or reserved/);
    expect(() => assertHostAllowed('[::1]', false)).toThrow(/private or reserved/);
    expect(() => assertHostAllowed('127.0.0.1', true)).not.toThrow();
  });

  it('leaves hostnames to the guarded lookup and allows public IPs', () => {
    expect(() => assertHostAllowed('erp.example.com', false)).not.toThrow();
    expect(() => assertHostAllowed('8.8.8.8', false)).not.toThrow();
  });
});
