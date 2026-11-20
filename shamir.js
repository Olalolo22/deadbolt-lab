// Shamir's Secret Sharing over GF(2^8) — Adi Shamir, 1979.
// "The Brain" of the creature. Splits a byte array into n shares; any k rebuild it.

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    // multiply by generator 3 in GF(2^8) with AES polynomial 0x11b
    x ^= (x << 1) ^ (x & 0x80 ? 0x11b : 0);
    x &= 0xff;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
const div = (a, b) => {
  if (b === 0) throw new Error("division by zero");
  return a === 0 ? 0 : EXP[(LOG[a] + 255 - LOG[b]) % 255];
};

/** Split `secret` (Uint8Array) into `n` shares, threshold `k`. Share = { x, y: Uint8Array } */
export function split(secret, n = 3, k = 2) {
  if (k > n || n > 255 || k < 2) throw new Error("bad threshold");
  const shares = Array.from({ length: n }, (_, i) => ({ x: i + 1, y: new Uint8Array(secret.length) }));
  const coeffs = new Uint8Array(k - 1);
  for (let b = 0; b < secret.length; b++) {
    crypto.getRandomValues(coeffs);
    for (const s of shares) {
      // Horner: f(x) = secret + c1 x + c2 x^2 ...
      let acc = 0;
      for (let c = coeffs.length - 1; c >= 0; c--) acc = mul(acc, s.x) ^ coeffs[c];
      s.y[b] = mul(acc, s.x) ^ secret[b];
    }
  }
  return shares;
}

/** Rebuild the secret from >= k shares via Lagrange interpolation at x = 0. */
export function combine(shares) {
  const len = shares[0].y.length;
  const out = new Uint8Array(len);
  for (let b = 0; b < len; b++) {
    let acc = 0;
    for (let i = 0; i < shares.length; i++) {
      let num = 1, den = 1;
      for (let j = 0; j < shares.length; j++) {
        if (i === j) continue;
        num = mul(num, shares[j].x);
        den = mul(den, shares[i].x ^ shares[j].x);
      }
      acc ^= mul(shares[i].y[b], div(num, den));
    }
    out[b] = acc;
  }
  return out;
}

export const toHex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
export const fromHex = (hex) => {
  const clean = hex.replace(/[^0-9a-f]/gi, "");
  if (clean.length % 2) throw new Error("odd hex");
  return new Uint8Array(clean.match(/../g).map((h) => parseInt(h, 16)));
};

/** Shares travel as "DB1-<x>-<hex>" so a human can paste them. */
export const encodeShare = (s) => `DB1-${s.x}-${toHex(s.y)}`;
export const decodeShare = (str) => {
  const m = str.trim().match(/^DB1-(\d+)-([0-9a-f]+)$/i);
  if (!m) throw new Error("That doesn't look like a DeadBolt shard.");
  return { x: Number(m[1]), y: fromHex(m[2]) };
};
