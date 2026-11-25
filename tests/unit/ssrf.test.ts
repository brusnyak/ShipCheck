import { describe, expect, it } from 'vitest';
import {
  isPrivateOrReservedIp,
  normalizeAndValidateUrl,
  SsrfGuardError,
} from '../../backend/src/security/ssrf.ts';

const publicDns = async () => [{ address: '93.184.216.34', family: 4 }];

describe('SSRF Security Guard', () => {
  it('allows valid public HTTPS and HTTP URLs', async () => {
    const res = await normalizeAndValidateUrl('https://example.com/app#section', {
      dnsLookup: publicDns,
    });
    expect(res.normalizedUrl).toBe('https://example.com/app');
    expect(res.resolvedIps).toEqual(['93.184.216.34']);
  });

  it('rejects non-http/https protocols', async () => {
    await expect(
      normalizeAndValidateUrl('file:///etc/passwd', { dnsLookup: publicDns })
    ).rejects.toThrow(SsrfGuardError);

    await expect(
      normalizeAndValidateUrl('javascript:alert(1)', { dnsLookup: publicDns })
    ).rejects.toThrow(SsrfGuardError);
  });

  it('rejects embedded credentials in URLs', async () => {
    await expect(
      normalizeAndValidateUrl('https://admin:secret@example.com/', { dnsLookup: publicDns })
    ).rejects.toThrow(/credentials/i);
  });

  it('blocks loopback, RFC1918 private, link-local, and cloud metadata IPs', async () => {
    const blockedUrls = [
      'http://127.0.0.1:3000/',
      'http://10.0.0.1/admin',
      'http://172.16.5.4/',
      'http://192.168.1.10/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]:3000/',
      'http://localhost:8080/',
      'http://internal-service.local/',
      'http://metadata.google.internal/computeMetadata/v1/',
    ];

    for (const url of blockedUrls) {
      await expect(
        normalizeAndValidateUrl(url, { allowLocalScans: false, dnsLookup: publicDns })
      ).rejects.toThrow(SsrfGuardError);
    }
  });

  it('blocks public hostnames whose DNS resolves to private/metadata IPs', async () => {
    await expect(
      normalizeAndValidateUrl('https://rebind.attacker.test/', {
        allowLocalScans: false,
        dnsLookup: async () => [{ address: '10.10.0.5', family: 4 }],
      })
    ).rejects.toThrow(/blocked address/i);

    await expect(
      normalizeAndValidateUrl('https://meta.attacker.test/', {
        allowLocalScans: false,
        dnsLookup: async () => [{ address: '169.254.169.254', family: 4 }],
      })
    ).rejects.toThrow(/blocked address/i);
  });

  it('permits loopback when allowLocalScans=true but still blocks cloud metadata', async () => {
    const localRes = await normalizeAndValidateUrl('http://127.0.0.1:3000/api/demo/broken-target', {
      allowLocalScans: true,
    });
    expect(localRes.normalizedUrl).toBe('http://127.0.0.1:3000/api/demo/broken-target');

    await expect(
      normalizeAndValidateUrl('http://169.254.169.254/latest/meta-data/', {
        allowLocalScans: true,
      })
    ).rejects.toThrow(SsrfGuardError);

    expect(isPrivateOrReservedIp('::ffff:127.0.0.1', false)).toBe(true);
    expect(isPrivateOrReservedIp('169.254.169.254', true)).toBe(true);
  });
});
