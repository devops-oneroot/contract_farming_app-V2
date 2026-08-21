/** An Indian mobile number. Anything longer is a typo, not a number. */
export const MOBILE_DIGITS = 10;

/** Just the digits, so a number reads the same however it was typed or pasted. */
export const digitsOf = (v: string) => (v ?? '').replace(/\D/g, '');

/**
 * What a mobile field should hold after a keystroke: digits only, ten at most.
 *
 * `keyboardType="phone-pad"` is a hint, not a rule — it still offers +, spaces
 * and brackets, and a pasted number can carry anything at all. Stripping here
 * is what actually keeps the stored number dialable.
 */
export const asMobile = (v: string) => digitsOf(v).slice(0, MOBILE_DIGITS);

/**
 * What a name-OR-number search box should hold.
 *
 * A search box cannot simply cap at ten characters: most of what is typed into
 * it is a name, and names run longer than that. So the cap applies only once
 * what has been typed is unambiguously a number — at which point an eleventh
 * digit can only be a mistake, and one that would silently return nothing.
 */
export function limitSearch(v: string) {
  const raw = v ?? '';
  // Phone punctuation counts as part of a number, not as letters: a pasted
  // "+91 99007 68505" is plainly a number, and treating the + as text would
  // leave it uncapped and matching nothing, since stored numbers are ten bare
  // digits.
  const isNumber = /^[\d+\-()\s]+$/.test(raw) && /\d/.test(raw);
  if (!isNumber) return raw;

  let digits = digitsOf(raw);
  // A country code or a trunk zero in front of a full number is a prefix, not
  // the number. Only stripped when what is left is exactly a mobile, so a
  // half-typed number is never rewritten under the agent's fingers.
  if (digits.length === MOBILE_DIGITS + 2 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === MOBILE_DIGITS + 1 && digits.startsWith('0')) digits = digits.slice(1);

  return digits.slice(0, MOBILE_DIGITS);
}
