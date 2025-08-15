export function loadGooglePrivateKey(): string {
  // Accept either name to avoid typos in env
  const b64Raw =
    (process.env.GOOGLE_PRIVATE_KEY_BASE64 ||
     process.env.GOOGLE_PRIVATE_KEY_B64 ||
     '').trim();

  if (b64Raw) {
    // Remove accidental surrounding quotes/backticks
    const b64 = b64Raw.replace(/^["'`]|["'`]$/g, '');
    const decoded = Buffer.from(b64, 'base64').toString('utf8').trim();

    // Case A: Decoded is already a PEM
    if (decoded.startsWith('-----BEGIN ')) return decoded;

    // Case B: Decoded might be the whole JSON key
    try {
      const obj = JSON.parse(decoded);
      const k = typeof obj?.private_key === 'string' ? obj.private_key.trim() : '';
      if (k) return k.includes('\\n') ? k.replace(/\\n/g, '\n') : k;
    } catch { /* not JSON */ }

    // Case C: Decoded is a quoted PEM string
    const unq = decoded.replace(/^["'`]|["'`]$/g, '');
    if (unq.includes('BEGIN PRIVATE KEY')) {
      return unq.includes('\\n') ? unq.replace(/\\n/g, '\n') : unq;
    }
  }

  // Fallback: non-base64 env with \n escapes
  const raw = (process.env.GOOGLE_PRIVATE_KEY || '').trim();
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}
