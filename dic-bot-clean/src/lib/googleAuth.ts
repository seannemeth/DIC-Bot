// src/lib/googleAuth.ts (replace the readFromBase64() with this)
function tryParseJSON(s: string) {
  try { return JSON.parse(s); } catch { return null; }
}

function b64FixPadding(b64: string) {
  const mod = b64.length % 4;
  return mod === 0 ? b64 : b64 + "=".repeat(4 - mod);
}

function decodeBase64Flexible(b64: string): string {
  // Handle URL-safe base64 and missing padding
  const urlSafe = b64.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64FixPadding(urlSafe);
  return Buffer.from(padded, "base64").toString("utf8");
}

function readFromBase64(): SAJson | null {
  const raw = process.env.GOOGLE_CREDENTIALS_BASE64;
  if (!raw) return null;

  // Case A: Some folks paste the raw JSON here (not base64).
  const rawAsJson = tryParseJSON(raw);
  if (rawAsJson?.client_email && rawAsJson?.private_key) {
    return {
      client_email: String(rawAsJson.client_email),
      private_key: normalizePrivateKey(String(rawAsJson.private_key)),
    };
  }

  // Case B: Proper (or slightly malformed) base64 → JSON
  const attempts: Array<{label: string; value: string | null}> = [];
  try {
    attempts.push({ label: "single", value: decodeBase64Flexible(raw) });
  } catch { attempts.push({ label: "single", value: null }); }

  // Case C: Double-encoded base64
  if (attempts[0]?.value) {
    try {
      const d2 = decodeBase64Flexible(attempts[0].value);
      attempts.push({ label: "double", value: d2 });
    } catch { /* ignore */ }
  }

  for (const a of attempts) {
    if (!a.value) continue;
    const parsed = tryParseJSON(a.value);
    if (parsed?.client_email && parsed?.private_key) {
      return {
        client_email: String(parsed.client_email),
        private_key: normalizePrivateKey(String(parsed.private_key)),
      };
    }
  }

  throw new Error(
    "Base64 creds did not decode to valid service-account JSON (client_email/private_key). Recreate the env value."
  );
}
