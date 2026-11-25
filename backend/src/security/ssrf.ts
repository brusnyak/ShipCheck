import dns from 'node:dns/promises';
import net from 'node:net';

export class SsrfGuardError extends Error {
  public readonly code: string;
  constructor(message: string, code = 'SSRF_BLOCKED') {
    super(message);
    this.name = 'SsrfGuardError';
    this.code = code;
  }
}

export interface SsrfValidationOptions {
  allowLocalScans?: boolean;
  dnsLookup?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
}

export interface ValidatedTarget {
  url: URL;
  normalizedUrl: string;
  hostname: string;
  resolvedIps: string[];
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    throw new SsrfGuardError(`Malformed IPv4 address: ${ip}`, 'INVALID_IP');
  }
  return ((parts[0] << 24) >>> 0) + ((parts[1] << 16) >>> 0) + ((parts[2] << 8) >>> 0) + (parts[3] >>> 0);
}

function inCidr4(ip: string, network: string, maskBits: number): boolean {
  const ipInt = ipv4ToInt(ip);
  const netInt = ipv4ToInt(network);
  const mask = maskBits === 0 ? 0 : (~((1 << (32 - maskBits)) - 1)) >>> 0;
  return (ipInt & mask) === (netInt & mask);
}

function extractMappedIpv4(ip: string): string | null {
  const lower = ip.toLowerCase();
  if (lower.startsWith('::ffff:')) {
    const tail = lower.slice(7);
    if (net.isIPv4(tail)) {
      return tail;
    }
    const hexMatch = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail);
    if (hexMatch) {
      const hi = Number.parseInt(hexMatch[1], 16);
      const lo = Number.parseInt(hexMatch[2], 16);
      return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
    }
  }
  return null;
}

export function isCloudMetadataIp(ip: string): boolean {
  const normalized = ip.toLowerCase();
  const mapped4 = extractMappedIpv4(normalized);
  const v4 = net.isIPv4(normalized) ? normalized : mapped4;
  if (v4) {
    // AWS/GCP/Azure link-local metadata range 169.254.0.0/16 and specific 169.254.169.254
    return inCidr4(v4, '169.254.0.0', 16);
  }
  // AWS IPv6 metadata endpoint fd00:ec2::254
  return normalized === 'fd00:ec2::254';
}

export function isLoopbackIp(ip: string): boolean {
  const normalized = ip.toLowerCase();
  const mapped4 = extractMappedIpv4(normalized);
  const v4 = net.isIPv4(normalized) ? normalized : mapped4;
  if (v4) {
    return inCidr4(v4, '127.0.0.0', 8);
  }
  return normalized === '::1' || normalized === '0:0:0:0:0:0:0:1';
}

export function isPrivateOrReservedIp(ip: string, allowLocalScans = false): boolean {
  const normalized = ip.toLowerCase().split('%')[0];

  // Cloud metadata is ALWAYS blocked, even when allowLocalScans=true
  if (isCloudMetadataIp(normalized)) {
    return true;
  }

  if (allowLocalScans && isLoopbackIp(normalized)) {
    return false;
  }

  const mapped4 = extractMappedIpv4(normalized);
  const v4 = net.isIPv4(normalized) ? normalized : mapped4;
  if (v4) {
    return (
      inCidr4(v4, '0.0.0.0', 8) || // Current network
      inCidr4(v4, '10.0.0.0', 8) || // RFC1918
      inCidr4(v4, '100.64.0.0', 10) || // Carrier-grade NAT
      inCidr4(v4, '127.0.0.0', 8) || // Loopback
      inCidr4(v4, '169.254.0.0', 16) || // Link-local / Cloud metadata
      inCidr4(v4, '172.16.0.0', 12) || // RFC1918
      inCidr4(v4, '192.0.0.0', 24) || // IETF protocol assignments
      inCidr4(v4, '192.168.0.0', 16) || // RFC1918
      inCidr4(v4, '198.18.0.0', 15) || // Benchmarking
      inCidr4(v4, '224.0.0.0', 4) || // Multicast
      inCidr4(v4, '240.0.0.0', 4) // Reserved
    );
  }

  if (net.isIPv6(normalized)) {
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized === '0:0:0:0:0:0:0:1' ||
      normalized.startsWith('fc') || // Unique local fc00::/7
      normalized.startsWith('fd') || // Unique local fc00::/7
      normalized.startsWith('fe8') || // Link-local fe80::/10
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb') ||
      normalized.startsWith('ff') // Multicast
    );
  }

  return true;
}

function isBlockedHostname(hostname: string, allowLocalScans: boolean): boolean {
  const lower = hostname.toLowerCase().replace(/\.$/, '');
  if (!lower) return true;

  const alwaysBlockedHosts = new Set([
    'metadata.google.internal',
    'metadata',
    'instance-data',
    '169.254.169.254',
  ]);
  if (alwaysBlockedHosts.has(lower)) {
    return true;
  }

  if (lower.endsWith('.internal') || lower.endsWith('.local') || lower.endsWith('.arpa')) {
    return true;
  }

  if (!allowLocalScans) {
    if (lower === 'localhost' || lower.endsWith('.localhost') || lower === '0.0.0.0') {
      return true;
    }
  }

  return false;
}

export async function normalizeAndValidateUrl(
  rawUrl: string,
  options: SsrfValidationOptions = {}
): Promise<ValidatedTarget> {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new SsrfGuardError('Target URL cannot be empty.', 'EMPTY_URL');
  }

  const withProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new SsrfGuardError('Invalid target URL format.', 'INVALID_URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SsrfGuardError(
      `Unsupported URL protocol "${parsed.protocol}". Only http: and https: are allowed.`,
      'UNSUPPORTED_PROTOCOL'
    );
  }

  if (parsed.username || parsed.password) {
    throw new SsrfGuardError(
      'Target URLs must not contain embedded username or password credentials.',
      'EMBEDDED_CREDENTIALS'
    );
  }

  const allowLocalScans = options.allowLocalScans ?? process.env.ALLOW_LOCAL_SCANS === 'true';
  const rawHost = parsed.hostname.replace(/^\[|\]$/g, '');

  if (isBlockedHostname(rawHost, allowLocalScans)) {
    throw new SsrfGuardError(
      `Scanning internal or restricted hostname "${rawHost}" is blocked.`,
      'BLOCKED_HOSTNAME'
    );
  }

  const resolvedIps: string[] = [];
  if (net.isIP(rawHost)) {
    if (isPrivateOrReservedIp(rawHost, allowLocalScans)) {
      throw new SsrfGuardError(
        `Scanning private, loopback, or cloud-metadata IP "${rawHost}" is blocked.`,
        'BLOCKED_IP'
      );
    }
    resolvedIps.push(rawHost);
  } else {
    const lookupFn =
      options.dnsLookup ??
      (async (host: string) => {
        const records = await dns.lookup(host, { all: true, verbatim: true });
        return records.map((r) => ({ address: r.address, family: r.family }));
      });

    let records: Array<{ address: string; family: number }>;
    try {
      records = await lookupFn(rawHost);
    } catch {
      throw new SsrfGuardError(
        `Could not resolve DNS for hostname "${rawHost}".`,
        'DNS_RESOLUTION_FAILED'
      );
    }

    if (!records || records.length === 0) {
      throw new SsrfGuardError(`No DNS records found for "${rawHost}".`, 'DNS_EMPTY');
    }

    for (const record of records) {
      if (isPrivateOrReservedIp(record.address, allowLocalScans)) {
        throw new SsrfGuardError(
          `Hostname "${rawHost}" resolved to blocked address ${record.address}.`,
          'BLOCKED_DNS_IP'
        );
      }
      resolvedIps.push(record.address);
    }
  }

  parsed.hash = '';
  return {
    url: parsed,
    normalizedUrl: parsed.toString(),
    hostname: rawHost,
    resolvedIps,
  };
}
