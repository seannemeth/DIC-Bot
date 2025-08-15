export const command = {
  data: new SlashCommandBuilder()
    .setName('lines')
    .setDescription('Show current betting lines (from Google Sheets)'),
  async execute(interaction: any) {
    await interaction.deferReply();
    try {
      const doc = await getDoc();
      const sheet = doc.sheetsByTitle['Lines'];
      if (!sheet) {
        const titles = Object.values(doc.sheetsByTitle).map((s: any) => s.title);
        await interaction.editReply(`Could not find a tab named **Lines**.\nAvailable: ${titles.join(', ')}`);
        return;
      }
      const rows = await sheet.getRows({ limit: 25 });
      if (!rows.length) {
        await interaction.editReply('No lines available yet on the **Lines** tab.');
        return;
      }
      const lines = rows.map((r: any, i: number) => {
        const wk = r.Week ?? '?';
        const h = r.HomeTeam ?? 'Home';
        const a = r.AwayTeam ?? 'Away';
        const spr = r.Spread ?? '-';
        const tot = r.Total ?? '-';
        const hml = r.HomeML ?? '-';
        const aml = r.AwayML ?? '-';
        return `**${i + 1}. Week ${wk}: ${h} vs ${a}**\nSpread: ${spr} | Total: ${tot} | ML: ${hml} / ${aml}`;
      });
      await interaction.editReply({ content: lines.join('\n\n') });
    } catch (e: any) {
      await interaction.editReply(`❌ Sheets auth failed: \`${e?.message || e}\``);
    }
  },
} as const;
