/**
 * SSRF (Server-Side Request Forgery) Protection
 *
 * Prevents requests to internal/private IP addresses, cloud metadata services,
 * loopback interfaces, and non-standard schemes.
 */

// Denied schemes
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

// Denied hostname suffixes
const BLOCKED_HOSTNAME_SUFFIXES = [
  'localhost',
  '.localhost',
  '.local',
  '.internal',
  '.lan',
  '.home',
  '.corp',
  '.arpa',
]

// Blocked ports commonly used for internal services
const BLOCKED_PORTS = new Set([
  20, 21,    // FTP
  22,        // SSH
  23,        // Telnet
  25,        // SMTP
  53,        // DNS
  67, 68,    // DHCP
  69,        // TFTP
  110,       // POP3
  123,       // NTP
  137, 138, 139, 445, // NetBIOS / SMB
  143,       // IMAP
  161,       // SNMP
  389, 636,  // LDAP
  2375, 2376,// Docker daemon
  2379, 2380,// etcd
  3306,      // MySQL
  5432,      // PostgreSQL
  5000,      // Docker registry / Flask default
  6379,      // Redis
  8500,      // Consul
  9000,      // Portainer / PHP-FPM
  9090,      // Prometheus
  9200, 9300,// Elasticsearch
  11211,     // Memcached
  27017, 27018, // MongoDB
])

export interface SSRFCheckResult {
  safe: boolean
  error?: string
  url?: URL
}

/**
 * Parses IPv4 string into 32-bit unsigned integer.
 * Supports decimal, octal (0...), hex (0x...), and mixed formats.
 */
function parseIPv4(ipStr: string): number | null {
  const parts = ipStr.split('.')
  if (parts.length > 4 || parts.length === 0) return null

  const values: number[] = []
  for (const part of parts) {
    let val: number
    if (part.startsWith('0x') || part.startsWith('0X')) {
      val = parseInt(part, 16)
    } else if (part.startsWith('0') && part.length > 1 && !isNaN(Number(part))) {
      val = parseInt(part, 8)
    } else {
      val = parseInt(part, 10)
    }
    if (isNaN(val) || val < 0) return null
    values.push(val)
  }

  // Handle single integer IP (e.g. 2130706433 = 127.0.0.1)
  if (values.length === 1) {
    return values[0] >>> 0
  }

  // Standard 4-part IPv4
  if (values.length === 4) {
    if (values.some(v => v > 255)) return null
    return (((values[0] << 24) | (values[1] << 16) | (values[2] << 8) | values[3]) >>> 0)
  }

  // Class A (a.b = a.0.0.b)
  if (values.length === 2) {
    if (values[0] > 255 || values[1] > 0xffffff) return null
    return (((values[0] << 24) | values[1]) >>> 0)
  }

  // Class B (a.b.c = a.b.0.c)
  if (values.length === 3) {
    if (values[0] > 255 || values[1] > 255 || values[2] > 0xffff) return null
    return (((values[0] << 24) | (values[1] << 16) | values[2]) >>> 0)
  }

  return null
}

/**
 * Checks if IPv4 32-bit integer falls inside private, loopback, or metadata CIDR ranges.
 */
function isPrivateOrReservedIPv4(ipNum: number): boolean {
  // CIDR check helper: (ip & mask) === (network & mask)
  const inRange = (netStr: string, prefixLen: number): boolean => {
    const netParts = netStr.split('.').map(Number)
    const netNum = ((netParts[0] << 24) | (netParts[1] << 16) | (netParts[2] << 8) | netParts[3]) >>> 0
    const mask = prefixLen === 0 ? 0 : (((0xffffffff << (32 - prefixLen))) >>> 0)
    return (ipNum & mask) === (netNum & mask)
  }

  // 0.0.0.0/8 (Current network)
  if (inRange('0.0.0.0', 8)) return true
  // 10.0.0.0/8 (Private-Use Networks)
  if (inRange('10.0.0.0', 8)) return true
  // 100.64.0.0/10 (Shared Address Space / CGNAT)
  if (inRange('100.64.0.0', 10)) return true
  // 127.0.0.0/8 (Loopback)
  if (inRange('127.0.0.0', 8)) return true
  // 169.254.0.0/16 (Link Local / Cloud Metadata e.g. 169.254.169.254)
  if (inRange('169.254.0.0', 16)) return true
  // 172.16.0.0/12 (Private-Use Networks)
  if (inRange('172.16.0.0', 12)) return true
  // 192.0.0.0/24 (IETF Protocol Assignments)
  if (inRange('192.0.0.0', 24)) return true
  // 192.0.2.0/24 (TEST-NET-1)
  if (inRange('192.0.2.0', 24)) return true
  // 192.168.0.0/16 (Private-Use Networks)
  if (inRange('192.168.0.0', 16)) return true
  // 198.18.0.0/15 (Network Interconnect Device Benchmark Testing)
  if (inRange('198.18.0.0', 15)) return true
  // 198.51.100.0/24 (TEST-NET-2)
  if (inRange('198.51.100.0', 24)) return true
  // 203.0.113.0/24 (TEST-NET-3)
  if (inRange('203.0.113.0', 24)) return true
  // 224.0.0.0/4 (Multicast)
  if (inRange('224.0.0.0', 4)) return true
  // 240.0.0.0/4 (Reserved for Future Use)
  if (inRange('240.0.0.0', 4)) return true
  // 255.255.255.255 (Broadcast)
  if (ipNum === 0xffffffff) return true

  return false
}

/**
 * Checks if IPv6 address is loopback, unique local, link-local, or IPv4-mapped private.
 */
function isPrivateOrReservedIPv6(hostname: string): boolean {
  let clean = hostname.replace(/^\[|\]$/g, '').toLowerCase()

  // Loopback ::1 or unspecified ::
  if (clean === '::1' || clean === '::' || clean === '0:0:0:0:0:0:0:1') return true

  // Unique local addresses fc00::/7 (starts with fc or fd)
  if (clean.startsWith('fc') || clean.startsWith('fd')) return true

  // Link-local unicast fe80::/10 (starts with fe8, fe9, fea, feb)
  if (/^fe[89ab]/i.test(clean)) return true

  // IPv4-mapped IPv6 (::ffff:x.x.x.x)
  if (clean.startsWith('::ffff:') || clean.startsWith('0:0:0:0:0:ffff:')) {
    const lastPart = clean.split(':').pop() || ''
    const mappedIpv4 = parseIPv4(lastPart)
    if (mappedIpv4 !== null && isPrivateOrReservedIPv4(mappedIpv4)) return true
  }

  return false
}

/**
 * Validates a target URL against SSRF rules.
 *
 * @param rawUrl The URL to validate
 * @returns SSRFCheckResult with safe=true if allowed, safe=false with error if blocked.
 */
export function validateUrlSSRF(rawUrl: string): SSRFCheckResult {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { safe: false, error: 'URL must be a non-empty string' }
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    return { safe: false, error: `Invalid URL format: ${rawUrl}` }
  }

  // 1. Protocol check
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return {
      safe: false,
      error: `Blocked protocol '${parsed.protocol}'. Only http: and https: are allowed.`,
    }
  }

  // 2. Port check
  const port = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === 'https:' ? 443 : 80)
  if (BLOCKED_PORTS.has(port)) {
    return {
      safe: false,
      error: `Blocked port ${port}. Access to sensitive internal service ports is prohibited.`,
    }
  }

  const hostname = parsed.hostname.toLowerCase().trim()

  // 3. Block localhost and internal domain suffixes
  for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
    if (hostname === suffix || hostname.endsWith(suffix)) {
      return {
        safe: false,
        error: `Blocked internal/local hostname: '${hostname}'`,
      }
    }
  }

  // 4. Check for direct IPv4 or integer/hex/octal notation
  const ipv4Num = parseIPv4(hostname)
  if (ipv4Num !== null) {
    if (isPrivateOrReservedIPv4(ipv4Num)) {
      return {
        safe: false,
        error: `Blocked private/loopback/cloud metadata IPv4 address: '${hostname}'`,
      }
    }
  }

  // 5. Check for IPv6 notation
  if (hostname.includes(':') || hostname.startsWith('[')) {
    if (isPrivateOrReservedIPv6(hostname)) {
      return {
        safe: false,
        error: `Blocked private/loopback/link-local IPv6 address: '${hostname}'`,
      }
    }
  }

  return { safe: true, url: parsed }
}
