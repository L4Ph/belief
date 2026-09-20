/**
 * Confidence of a `noul` evaluation.
 *
 * TypeSafe Jev answers a `noul` with a probability only (`{ type: "noul", noul }`),
 * so bel defines confidence as the normalised distance from 0.5.
 * See RFC 0001 (bel v0), "Types".
 */
export function noulConfidence(p: number): number {
  return Math.abs(p - 0.5) * 2;
}
