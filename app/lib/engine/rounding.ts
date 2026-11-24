/**
 * Numeric rounding helpers that replicate Python's built-in `round()`.
 *
 * Python `round(x)` and `round(x, n)` use round-half-to-*even* (banker's
 * rounding), which is what the engine uses to produce the values in the
 * /analyze contract. The dashboard's *display* formatting (roundHalfUp in
 * lib/format.ts) is separate and not used by the engine.
 */

/**
 * Round half-to-even to `ndigits` decimal places (Python `round(x, ndigits)`).
 * Always returns a Java-Script double regardless of the ndigits, mirroring
 * Python where `round(x, ndigits)` returns a float (e.g. `round(507.2, 0)` ->
 * `507.0`).
 */
export function pyRound(value: number, ndigits: number): number {
  const mult = 10 ** ndigits;
  const scaled = value * mult;
  const neg = scaled < 0;
  const abs = Math.abs(scaled);
  const floor = Math.floor(abs);
  const frac = abs - floor;
  let rounded: number;
  if (frac > 0.5) rounded = floor + 1;
  else if (frac < 0.5) rounded = floor;
  else rounded = floor % 2 === 0 ? floor : floor + 1; // half -> even
  return (neg ? -rounded : rounded) / mult;
}

/**
 * Round half-to-even to an integer (Python `round(x)` with no ndigits),
 * which returns an int rather than a float.
 */
export function pyRoundInt(value: number): number {
  const neg = value < 0;
  const abs = Math.abs(value);
  const floor = Math.floor(abs);
  const frac = abs - floor;
  let rounded: number;
  if (frac > 0.5) rounded = floor + 1;
  else if (frac < 0.5) rounded = floor;
  else rounded = floor % 2 === 0 ? floor : floor + 1;
  return neg ? -rounded : rounded;
}
