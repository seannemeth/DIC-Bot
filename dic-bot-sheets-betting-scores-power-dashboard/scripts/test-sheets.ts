import 'dotenv/config';
import { loadSheet } from '../src/lib/sheets';

async function main() {
  const id = process.env.GOOGLE_SHEET_ID as string;
  const email = process.env.GOOGLE_CLIENT_EMAIL as string;
  const key = (process.env.GOOGLE_PRIVATE_KEY as string || '').replace(/\\n/g,'\n');
  if (!id || !email || !key) {
    console.error('Missing GOOGLE_SHEET_ID / GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY');
    process.exit(1);
  }
  const doc = await loadSheet(id, email, key);
  console.log('Loaded sheet. Tabs:');
  for (const [title] of Object.entries((doc as any).sheetsByTitle)) {
    console.log('-', title);
  }
}
main().catch(err => { console.error(err); process.exit(1); });
