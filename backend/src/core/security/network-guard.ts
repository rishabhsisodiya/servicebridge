import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { isIP } from 'node:net';

/**
 * Protects against server-side request forgery: admins type ERP addresses,
 * and without this an address could point the server at itself, the cloud
 * metadata endpoint or the internal network.
 */

const PRIVATE_V4: [number, number][] = [
  [0x00000000, 8], // 0.0.0.0/8 "this network"
  [0x0a000000, 8], // 10/8
  [0x64400000, 10], // 100.64/10 carrier-grade NAT
  [0x7f000000, 8], // 127/8 loopback
  [0xa9fe0000, 16], // 169.254/16 link-local, incl. cloud metadata 169.254.169.254
  [0xac100000, 12], // 172.16/12
  [0xc0a80000, 16], // 192.168/16
  [0xc6120000, 15], // 198.18/15 benchmarking
  [0xe0000000, 4], // 224/4 multicast
  [0xf0000000, 4], // 240/4 reserved
];

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const value = v4ToInt(address);
    return PRIVATE_V4.some(([base, bits]) => value >>> (32 - bits) === base >>> (32 - bits));
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return (
      lower === '::' ||
      lower === '::1' ||
      /^f[cd]/.test(lower) || // fc00::/7 unique local
      /^fe[89ab]/.test(lower) || // fe80::/10 link-local
      /^ff/.test(lower) // multicast
    );
  }
  return true; // not an IP at all: refuse rather than guess
}

export class BlockedAddressError extends Error {
  constructor(readonly host: string) {
    super(`${host} points to a private or reserved network address`);
  }
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/**
 * A drop-in for dns.lookup that refuses private addresses. Used by the HTTP
 * agent and before database connections, so the check applies to the address
 * actually connected to (defeats DNS rebinding), not just the one first typed.
 */
export function createGuardedLookup(allowPrivate: boolean) {
  return (
    hostname: string,
    options: { all?: boolean; family?: number } | number,
    callback: LookupCallback,
  ) => {
    const opts = typeof options === 'number' ? { family: options } : (options ?? {});
    dnsLookup(hostname, { ...opts, all: true }, (error, addresses) => {
      if (error) return callback(error, []);
      const list = addresses;
      if (!allowPrivate && list.some((a) => isPrivateAddress(a.address))) {
        const blocked = Object.assign(new BlockedAddressError(hostname), {
          code: 'EBLOCKEDADDRESS',
        });
        return callback(blocked, []);
      }
      if (opts.all) return callback(null, list);
      callback(null, list[0].address, list[0].family);
    });
  };
}

/** Resolves a host once and returns a safe IP to connect to. */
export function resolveSafeAddress(host: string, allowPrivate: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    createGuardedLookup(allowPrivate)(host, {}, (error, address) => {
      if (error) reject(error);
      else resolve(address as string);
    });
  });
}

export interface UrlRules {
  allowHttp: boolean;
}

/**
 * Normalises an ERP base URL to its origin. Returns a plain-English problem
 * instead of throwing, so the form can show it next to the field.
 */
export function normaliseBaseUrl(
  input: string,
  rules: UrlRules,
): { url?: string; problem?: string } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { problem: 'Enter the full address, for example https://erp.yourcompany.com' };
  }
  if (url.protocol !== 'https:' && !(rules.allowHttp && url.protocol === 'http:')) {
    return {
      problem: rules.allowHttp ? 'Use an http:// or https:// address.' : 'Use an https:// address.',
    };
  }
  if (url.username || url.password)
    return { problem: "Don't put a username or password in the address." };
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    return {
      problem:
        'Enter only the site address, without a path, for example https://erp.yourcompany.com',
    };
  }
  return { url: url.origin };
}

/**
 * Node skips DNS lookup for IP-literal hosts, so the guarded lookup never
 * runs for them. Call this before connecting to check such hosts directly.
 * `hostname` may be a URL hostname (IPv6 in brackets) or a bare host.
 */
export function assertHostAllowed(hostname: string, allowPrivate: boolean): void {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivate && isIP(host) && isPrivateAddress(host)) {
    throw Object.assign(new BlockedAddressError(host), { code: 'EBLOCKEDADDRESS' });
  }
}
