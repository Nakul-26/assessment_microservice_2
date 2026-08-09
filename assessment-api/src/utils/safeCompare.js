import crypto from "crypto";

// Constant-time comparison for shared-secret checks (API keys, service tokens). A plain
// `===`/`!==` on secret strings leaks timing information proportional to how many leading
// characters match, which crypto.timingSafeEqual avoids. Requires equal-length buffers, so
// a length mismatch is handled as an explicit false rather than throwing.
export function safeCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length === 0 || b.length === 0) {
    return false;
  }
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}
