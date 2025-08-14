import { GoogleSpreadsheet } from 'google-spreadsheet';

export async function loadSheet(docId: string, clientEmail: string, privateKey: string) {
  const doc = new GoogleSpreadsheet(docId);
  await (doc as any).useServiceAccountAuth({
    client_email: clientEmail,
    private_key: privateKey.replace(/\\n/g, '\n'),
  });
  await doc.loadInfo();
  return doc as any;
}

export async function ensureTabs(doc: any) {
  const wanted: Record<string, string[]> = {
    Scores: ['Date','Season','Week','HomeTeam','AwayTeam','HomePts','AwayPts','Reporter'],
    Standings: ['Team','W','L','T','PF','PA','Diff'],
    Bets: ['BetId','Coach','Season','Week','GameId','Market','Side','Line','Amount','Status','Payout','PlacedAt','SettledAt'],
    PowerRankings: ['Rank','Team','PR','Elo','W','L','Diff'],
    Teams: ['Team','Conference','Emoji'],
    Emojis: ['EmojiId','Team','EmojiName']
  };
  for (const [title, headers] of Object.entries(wanted)) {
    if (!doc.sheetsByTitle[title]) {
      const sheet = await doc.addSheet({ title });
      await sheet.setHeaderRow(headers);
    } else {
      const sheet = doc.sheetsByTitle[title];
      await sheet.loadHeaderRow();
      await sheet.setHeaderRow(headers);
    }
  }
}
