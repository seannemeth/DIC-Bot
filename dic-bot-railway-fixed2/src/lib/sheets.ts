import { GoogleSpreadsheet } from "google-spreadsheet";

export async function loadSheet(docId: string, clientEmail: string, privateKey: string) {
  const doc = new GoogleSpreadsheet(docId);
  // v3 API uses useServiceAccountAuth
  await doc.useServiceAccountAuth({
    client_email: clientEmail,
    private_key: privateKey.replace(/\\n/g, "\n"),
  } as any);
  await doc.loadInfo();
  return doc;
}
