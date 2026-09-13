/**
 * Error thrown when a MAC address fails validation or normalization.
 * Formatted with name 'BadRequestException' and statusCode 400 for NestJS/HTTP compatibility.
 */
export class InvalidMacAddressError extends Error {
  readonly statusCode: number = 400;

  constructor(message: string = 'Invalid MAC address format') {
    super(message);
    this.name = 'BadRequestException';
    Object.setPrototypeOf(this, InvalidMacAddressError.prototype);
  }
}

/**
 * Normalizes a MAC address into canonical uppercase colon-separated format (AA:BB:CC:DD:EE:FF).
 *
 * Accepted formats:
 * - Colon-separated: AA:BB:CC:DD:EE:FF / aa:bb:cc:dd:ee:ff
 * - Hyphen-separated: AA-BB-CC-DD-EE-FF / aa-bb-cc-dd-ee-ff
 * - Plain 12-char hex: AABBCCDDEEFF / aabbccddeeff
 * - Cisco dot notation: aabb.ccdd.eeff / AABB.CCDD.EEFF
 * - Standard dot notation: aa.bb.cc.dd.ee.ff / AA.BB.CC.DD.EE.FF
 *
 * Behavior:
 * - null, undefined, empty string, or whitespace-only returns null
 * - Strips valid separators (:, -, .)
 * - Validates that input contains only valid characters (hex digits and accepted separators)
 * - Validates exact length of 12 hexadecimal characters
 * - Returns canonical format: AA:BB:CC:DD:EE:FF
 * - Throws InvalidMacAddressError (name: 'BadRequestException') for invalid or malformed MAC addresses
 */
export function normalizeMacAddress(mac: string | null | undefined): string | null {
  if (mac === null || mac === undefined) {
    return null;
  }

  if (typeof mac !== 'string') {
    throw new InvalidMacAddressError('MAC address must be a string');
  }

  const trimmed = mac.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // 1. Check for invalid characters (only hex digits 0-9, a-f, A-F and delimiters : - . are allowed)
  if (/[^0-9a-fA-F:.-]/.test(trimmed)) {
    throw new InvalidMacAddressError(`Invalid MAC address: contains invalid characters in "${trimmed}"`);
  }

  // 2. Validate format structure against recognized standards:
  // - Standard colon: 6 pairs of hex digits separated by colons (e.g. AA:BB:CC:DD:EE:FF)
  // - Hyphen: 6 pairs of hex digits separated by hyphens (e.g. AA-BB-CC-DD-EE-FF)
  // - Dot standard: 6 pairs of hex digits separated by dots (e.g. AA.BB.CC.DD.EE.FF)
  // - Cisco dot notation: 3 quads of hex digits separated by dots (e.g. AABB.CCDD.EEFF)
  // - Cisco hyphen notation: 3 quads of hex digits separated by hyphens (e.g. AABB-CCDD-EEFF)
  // - Plain: exactly 12 hex digits with no delimiters (e.g. AABBCCDDEEFF)
  const isColon = /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(trimmed);
  const isHyphen = /^([0-9a-fA-F]{2}-){5}[0-9a-fA-F]{2}$/.test(trimmed);
  const isDotStandard = /^([0-9a-fA-F]{2}\.){5}[0-9a-fA-F]{2}$/.test(trimmed);
  const isDotCisco = /^([0-9a-fA-F]{4}\.){2}[0-9a-fA-F]{4}$/.test(trimmed);
  const isHyphenCisco = /^([0-9a-fA-F]{4}-){2}[0-9a-fA-F]{4}$/.test(trimmed);
  const isPlain = /^[0-9a-fA-F]{12}$/.test(trimmed);

  // Extract pure hex digits
  const hexOnly = trimmed.replace(/[:.-]/g, '');

  if (hexOnly.length !== 12) {
    throw new InvalidMacAddressError(
      `Invalid MAC address length: expected 12 hexadecimal characters, got ${hexOnly.length} in "${trimmed}"`
    );
  }

  if (!isColon && !isHyphen && !isDotStandard && !isDotCisco && !isHyphenCisco && !isPlain) {
    throw new InvalidMacAddressError(`Malformed MAC address format: "${trimmed}"`);
  }

  const upper = hexOnly.toUpperCase();
  return `${upper.slice(0, 2)}:${upper.slice(2, 4)}:${upper.slice(4, 6)}:${upper.slice(6, 8)}:${upper.slice(8, 10)}:${upper.slice(10, 12)}`;
}

/**
 * Predicate helper to check whether a given string is a valid MAC address in any accepted format.
 */
export function isValidMacAddress(mac: string | null | undefined): boolean {
  if (!mac || (typeof mac === 'string' && mac.trim() === '')) {
    return false;
  }
  try {
    normalizeMacAddress(mac);
    return true;
  } catch {
    return false;
  }
}
