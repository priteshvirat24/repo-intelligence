import dns from 'dns/promises';
import net from 'net';

export interface SSRFValidationResult {
  valid: boolean;
  normalizedUrl?: string;
  error?: string;
  errorCode?: 'INVALID_URL' | 'UNSUPPORTED_PROTOCOL' | 'PRIVATE_IP_BLOCKED' | 'CLOUD_METADATA_BLOCKED' | 'DNS_RESOLUTION_FAILED';
}

/**
 * Checks whether an IPv4 or IPv6 address belongs to private, loopback, link-local, or cloud metadata ranges.
 */
export function isPrivateOrReservedIP(ip: string): boolean {
  if (!net.isIP(ip)) return false;

  // IPv4 checks
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(p => parseInt(p, 10));
    const [b0, b1, b2, b3] = parts;

    // 0.0.0.0/8 (Current network)
    if (b0 === 0) return true;

    // 127.0.0.0/8 (Loopback)
    if (b0 === 127) return true;

    // 10.0.0.0/8 (Private)
    if (b0 === 10) return true;

    // 172.16.0.0/12 (Private)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;

    // 192.168.0.0/16 (Private)
    if (b0 === 192 && b1 === 168) return true;

    // 169.254.0.0/16 (Link-local & AWS/GCP/Azure Cloud Metadata 169.254.169.254)
    if (b0 === 169 && b1 === 254) return true;

    // 100.64.0.0/10 (Carrier-grade NAT)
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;

    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (b0 === 192 && b1 === 0 && b2 === 0) return true;

    // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 (Documentation/TEST-NET)
    if ((b0 === 192 && b1 === 0 && b2 === 2) || (b0 === 198 && b1 === 51 && b2 === 100) || (b0 === 203 && b1 === 0 && b2 === 113)) return true;

    // 224.0.0.0/4 (Multicast)
    if (b0 >= 224 && b0 <= 239) return true;

    // 240.0.0.0/4 (Reserved / Future use / Broadcast 255.255.255.255)
    if (b0 >= 240) return true;

    return false;
  }

  // IPv6 checks
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    // Loopback ::1
    if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;
    // Unspecified ::
    if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true;
    // IPv4-mapped IPv6 (::ffff:127.0.0.1)
    if (lower.startsWith('::ffff:')) {
      const ipv4Part = lower.replace('::ffff:', '');
      if (net.isIPv4(ipv4Part)) {
        return isPrivateOrReservedIP(ipv4Part);
      }
    }
    // Unique local address fc00::/7 (fc00 - fdff)
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    // Link-local address fe80::/10 (fe80 - febf)
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;

    return false;
  }

  return false;
}

/**
 * Validates a resource URL against SSRF vulnerabilities, checking protocol, hostname, and resolved IP addresses.
 */
export async function validateResourceUrlSecurity(rawUrl: string): Promise<SSRFValidationResult> {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, error: 'URL must be a non-empty string.', errorCode: 'INVALID_URL' };
  }

  const trimmed = rawUrl.trim();
  if (trimmed.length > 2048) {
    return { valid: false, error: 'URL exceeds maximum length of 2048 characters.', errorCode: 'INVALID_URL' };
  }

  // Enforce http or https protocol
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: 'Malformed URL format. Please provide a valid URL.', errorCode: 'INVALID_URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      error: `Unsupported protocol "${parsed.protocol}". Only public http:// and https:// URLs are permitted.`,
      errorCode: 'UNSUPPORTED_PROTOCOL'
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost and metadata hostnames directly
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === 'metadata.google.internal' ||
    hostname === 'instance-data'
  ) {
    return {
      valid: false,
      error: 'Requests to localhost and internal domain names are strictly forbidden.',
      errorCode: 'PRIVATE_IP_BLOCKED'
    };
  }

  // If hostname is directly an IP address
  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIP(hostname)) {
      return {
        valid: false,
        error: 'Requests to private, loopback, or cloud metadata IP addresses are strictly forbidden.',
        errorCode: 'PRIVATE_IP_BLOCKED'
      };
    }
  } else {
    // Resolve hostname via DNS to ensure it does not point to internal IP
    try {
      const addresses = await dns.lookup(hostname, { all: true });
      for (const addr of addresses) {
        if (isPrivateOrReservedIP(addr.address)) {
          return {
            valid: false,
            error: `Hostname "${hostname}" resolves to protected or internal IP (${addr.address}), which is forbidden.`,
            errorCode: 'PRIVATE_IP_BLOCKED'
          };
        }
      }
    } catch (dnsErr: any) {
      // If DNS resolution fails, block it
      return {
        valid: false,
        error: `Could not resolve hostname "${hostname}". Check that the domain name is valid and publicly registered.`,
        errorCode: 'DNS_RESOLUTION_FAILED'
      };
    }
  }

  return {
    valid: true,
    normalizedUrl: parsed.toString()
  };
}
