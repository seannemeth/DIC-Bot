import { google } from 'googleapis';

function decodeBase64Json(b64: string) {
  try {
    const json = Buffer.from(b64, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export async function getGoogleAuthClient() {
  const b64 = process.env.GOOGLE_CREDENTIALS_BASE64?.trim();
  const email = process.env.GOOGLE_CLIENT_EMAIL?.trim();
  let key = process.env.GOOGLE_PRIVATE_KEY?.trim();

  // Try full JSON first
  if (b64) {
    const parsed = decodeBase64Json(b64);
    if (parsed?.client_email && parsed?.private_key) {
      return new google.auth.JWT({
        email: parsed.client_email,
        key: parsed.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    }
    console.error('⚠️ GOOGLE_CREDENTIALS_BASE64 exists but is not valid JSON with client_email/private_key.');
  }

  // Fallback: email + key
  if (email && key) {
    if (key.includes('\\n')) key = key.replace(/\\n/g, '\n'); // fix escaped newlines
    return new google.auth.JWT({
      email,
      key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }

  throw new Error('Missing Google credentials. Provide GOOGLE_CREDENTIALS_BASE64 or GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY.');
}
