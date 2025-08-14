import { GoogleSpreadsheet } from 'google-spreadsheet';

export async function loadSheet(docId: string, clientEmail: string, privateKey: string) {
  const doc = new GoogleSpreadsheet(docId);
  await doc.useServiceAccountAuth({
    client_email: clientEmail,
    private_key: privateKey.replace(/\\n/g, '\n'),
  });
  await doc.loadInfo();
  return doc;
}
