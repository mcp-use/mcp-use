/**
 * IP address classification shared by the OAuth proxy (CIMD fetches) and the
 * Events webhook senders. Lifted from `oauth/proxy/clients.ts`.
 *
 * @internal
 */

/** @internal Whether `host` (brackets already removed) is an IPv4 or IPv6 literal. */
export function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

/** Parses dotted-quad IPv4, or returns `undefined`. */
function parseIpv4(address: string): number[] | undefined {
  const match = address.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (match === null) return undefined;
  const octets = match.slice(1).map(Number);
  return octets.every((octet) => octet <= 255) ? octets : undefined;
}

/** Parses an IPv6 address (with an optional dotted IPv4 tail) into 8 hextets. */
function parseIpv6(address: string): number[] | undefined {
  let text = address.toLowerCase();
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);
  const lastColon = text.lastIndexOf(":");
  const maybeV4 = text.slice(lastColon + 1);
  if (maybeV4.includes(".")) {
    const v4 = parseIpv4(maybeV4);
    if (v4 === undefined) return undefined;
    const high = ((v4[0]! << 8) | v4[1]!).toString(16);
    const low = ((v4[2]! << 8) | v4[3]!).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const parse = (part: string): number[] | undefined => {
    if (part === "") return [];
    const values: number[] = [];
    for (const group of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return undefined;
      values.push(parseInt(group, 16));
    }
    return values;
  };
  const head = parse(halves[0]!);
  const rest = halves.length === 2 ? parse(halves[1]!) : [];
  if (head === undefined || rest === undefined) return undefined;
  const total = head.length + rest.length;
  if (halves.length === 1) return total === 8 ? head : undefined;
  if (total > 7) return undefined;
  return [...head, ...new Array<number>(8 - total).fill(0), ...rest];
}

function isPrivateIpv4([a, b, c]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    // 192.0.0.0/24 IETF assignments, 192.0.2.0/24 TEST-NET-1,
    // 192.88.99.0/24 6to4 relay anycast.
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    // 198.51.100.0/24 TEST-NET-2 and 203.0.113.0/24 TEST-NET-3.
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a! >= 224
  );
}

/**
 * @internal Whether an IP address is not publicly routable: loopback,
 * private, link-local, CGNAT, multicast, reserved and documentation ranges,
 * and IPv6 forms that can tunnel to them (IPv4-mapped and IPv4-compatible,
 * NAT64, 6to4 `2002::/16`, Teredo and the rest of `2001::/23`,
 * `2001:db8::/32`). Anything that does not parse is treated as private.
 */
export function isPrivateAddress(address: string): boolean {
  const ipv4 = parseIpv4(address);
  if (ipv4 !== undefined) return isPrivateIpv4(ipv4);
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return true;
  const h = parseIpv6(address);
  if (h === undefined) return true;
  const [h0, h1, h2, h3, h4] = h as [number, number, number, number, number];
  // ::/96 covers ::, ::1 and the deprecated IPv4-compatible ::a.b.c.d.
  // ::ffff:0:0/96 IPv4-mapped is refused outright, like the original check.
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0) return true;
  return (
    // 64:ff9b::/96 and 64:ff9b:1::/48 NAT64.
    (h0 === 0x64 && h1 === 0xff9b) ||
    // 100::/64 discard-only.
    (h0 === 0x100 && h1 === 0 && h2 === 0 && h3 === 0) ||
    // 2001::/23: Teredo 2001::/32, benchmarking, ORCHID and other IETF uses.
    (h0 === 0x2001 && h1 < 0x200) ||
    // 2001:db8::/32 documentation.
    (h0 === 0x2001 && h1 === 0xdb8) ||
    // 2002::/16 6to4.
    h0 === 0x2002 ||
    // 3fff::/20 documentation.
    (h0 & 0xfff0) === 0x3ff0 ||
    // fc00::/7 unique local, fe80::/10 link-local, fec0::/10 site-local,
    // ff00::/8 multicast.
    (h0 & 0xfe00) === 0xfc00 ||
    (h0 & 0xffc0) === 0xfe80 ||
    (h0 & 0xffc0) === 0xfec0 ||
    (h0 & 0xff00) === 0xff00
  );
}
