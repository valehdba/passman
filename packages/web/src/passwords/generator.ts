/**
 * CSPRNG-backed password generator + entropy estimator.
 *
 * No third-party dep. Uses `crypto.getRandomValues` (the Web Crypto API)
 * with rejection sampling so every char-set has exactly the same
 * probability — `% length` would bias toward the low end of the alphabet
 * for non-power-of-two charset sizes (e.g. 26 + 26 + 10 = 62 with the
 * common Aa-Zz0-9 set).
 */

export interface PasswordOptions {
  length: number;
  lowercase: boolean;
  uppercase: boolean;
  digits: boolean;
  symbols: boolean;
  /** Drop confusable characters (0/O/1/l/I) — useful when reading aloud. */
  avoidAmbiguous: boolean;
}

export const DEFAULT_OPTIONS: PasswordOptions = Object.freeze({
  length: 20,
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: true,
  avoidAmbiguous: false,
});

const LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
// A reasonably terminal-safe symbol set: avoids backtick (shell-quoting),
// backslash (escapes), and quotes (less surprise inside JSON / SQL strings).
const SYMBOLS = "!@#$%^&*()-_=+[]{};:,.<>/?";
const AMBIGUOUS = new Set("0O1lI|`");

export function buildAlphabet(opts: PasswordOptions): string {
  let alphabet = "";
  if (opts.lowercase) alphabet += LOWERCASE;
  if (opts.uppercase) alphabet += UPPERCASE;
  if (opts.digits) alphabet += DIGITS;
  if (opts.symbols) alphabet += SYMBOLS;
  if (opts.avoidAmbiguous) {
    alphabet = [...alphabet].filter((c) => !AMBIGUOUS.has(c)).join("");
  }
  return alphabet;
}

export class GeneratorError extends Error {}

/**
 * Generate a password matching `opts`. Throws `GeneratorError` if the
 * options would produce an empty alphabet (no char-set ticked) or a
 * zero/negative length.
 *
 * Strategy:
 *   1. Reserve one slot per requested class — guarantees coverage so the
 *      output reliably satisfies "must contain a digit / symbol" policies
 *      that upstream sites enforce.
 *   2. Fill remaining slots with uniform draws from the full alphabet.
 *   3. Shuffle the result so the reserved slots don't always sit up front.
 *
 * All randomness comes from a single CSPRNG (`crypto.getRandomValues`)
 * via rejection sampling so each char in the alphabet has equal
 * probability — `% length` would skew toward the start for non-power-of-two
 * alphabets.
 */
export function generatePassword(opts: PasswordOptions): string {
  if (opts.length < 1) {
    throw new GeneratorError("Length must be at least 1");
  }
  const alphabet = buildAlphabet(opts);
  if (alphabet.length === 0) {
    throw new GeneratorError("At least one character set must be enabled");
  }

  // Step 1: one-each-class reservations.
  const reservedSets: string[] = [];
  if (opts.lowercase) reservedSets.push(LOWERCASE);
  if (opts.uppercase) reservedSets.push(UPPERCASE);
  if (opts.digits) reservedSets.push(DIGITS);
  if (opts.symbols) reservedSets.push(SYMBOLS);

  const chars: string[] = [];
  // Reserve only as many class slots as the password length permits.
  // For very short passwords (length < #classes), we pick the first N.
  const reservations = reservedSets.slice(0, opts.length);
  for (const set of reservations) {
    chars.push(pickFrom(set, opts.avoidAmbiguous));
  }

  // Step 2: fill the remaining slots from the full alphabet.
  while (chars.length < opts.length) {
    chars.push(pickFrom(alphabet, false));
  }

  // Step 3: shuffle so the reserved chars don't always lead.
  fisherYatesShuffle(chars);
  return chars.join("");
}

function fisherYatesShuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = uniformIndex(i + 1);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}

function uniformIndex(rangeExclusive: number): number {
  // Rejection-sampled uniform index into [0, rangeExclusive).
  const max = 256 - (256 % rangeExclusive);
  const buf = new Uint8Array(1);
  while (true) {
    crypto.getRandomValues(buf);
    if (buf[0]! < max) return buf[0]! % rangeExclusive;
  }
}

function pickFrom(charset: string, avoidAmbiguous: boolean): string {
  const usable = avoidAmbiguous
    ? [...charset].filter((c) => !AMBIGUOUS.has(c)).join("")
    : charset;
  const max = 256 - (256 % usable.length);
  const buf = new Uint8Array(1);
  while (true) {
    crypto.getRandomValues(buf);
    if (buf[0]! < max) return usable[buf[0]! % usable.length]!;
  }
}

/** Shannon entropy in bits = length × log2(alphabet size). */
export function estimateEntropyBits(opts: PasswordOptions): number {
  const alphabet = buildAlphabet(opts);
  if (alphabet.length === 0 || opts.length === 0) return 0;
  return opts.length * Math.log2(alphabet.length);
}

/** Coarse strength label tied to entropy bits. Mirrors NIST SP 800-63B
 *  thresholds roughly — 60 bits = strong for online attacks, 80 for offline. */
export function strengthLabel(bits: number): "weak" | "fair" | "strong" | "excellent" {
  if (bits < 40) return "weak";
  if (bits < 60) return "fair";
  if (bits < 90) return "strong";
  return "excellent";
}
