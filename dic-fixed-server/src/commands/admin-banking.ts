import { SlashCommandBuilder } from "discord.js";
import { PrismaClient } from "@prisma/client";
import { loadSheet } from "../lib/sheets.js";
const prisma = new PrismaClient();
export const command = {
  adminOnly: true,
  data: new SlashCommandBuilder().setName("adminbank").setDescription("Bank & lines admin")
    .addSubcommand(sc=>sc.setName("grant").setDescription("Grant DIC$").addUserOption(o=>o.setName("coach").setDescription("Coach").setRequired(true)).addIntegerOption(o=>o.setName("amount").setDescription("Amount").setRequired(true)))
    .addSubcommand(sc=>sc.setName("set").setDescription("Set DIC$ balance").addUserOption(o=>o.setName("coach").setDescription("Coach").setRequired(true)).addIntegerOption(o=>o.setName("balance").setDescription("Balance").setRequired(true)))
    .addSubcommand(sc=>sc.setName("reset").setDescription("Reset wallets for season").addIntegerOption(o=>o.setName("season").setDescription("Season").setRequired(true)).addIntegerOption(o=>o.setName("start").setDescription("Starting DIC$").setRequired(true)))
    .addSubcommand(sc=>sc.setName("linessync").setDescription("Import lines from Google Sheet")),
  async execute(interaction:any){
    if (!interaction.memberPermissions?.has("Administrator")) { await interaction.reply({ content:"Admin only.", ephemeral:true }); return; }
    const sub = interaction.options.getSubcommand();
    if (sub==="grant"||sub==="set"){
      const u = interaction.options.getUser("coach", true);
      const coach = await prisma.coach.findUnique({ where:{ discordId: u.id } });
      if (!coach){ await interaction.reply({ content:"Coach not found; they must /setteam first.", ephemeral:true }); return; }
      let wallet = await prisma.wallet.findUnique({ where:{ coachId: coach.id } });
      if (!wallet) wallet = await prisma.wallet.create({ data:{ coachId: coach.id, balance:0 } });
      if (sub==="grant"){
        const amount = interaction.options.getInteger("amount", true);
        wallet = await prisma.wallet.update({ where:{ coachId: coach.id }, data:{ balance: wallet.balance + amount } });
        await interaction.reply(`Granted DIC$ ${amount} to ${coach.team || coach.handle}. New balance: ${wallet.balance}`);
      } else {
        const balance = interaction.options.getInteger("balance", true);
        wallet = await prisma.wallet.update({ where:{ coachId: coach.id }, data:{ balance } });
        await interaction.reply(`Set balance for ${coach.team || coach.handle}: DIC$ ${wallet.balance}`);
      }
      return;
    }
    if (sub==="reset"){
      const season = interaction.options.getInteger("season", true);
      const start = interaction.options.getInteger("start", true);
      const coaches = await prisma.coach.findMany();
      for (const c of coaches) await prisma.wallet.upsert({ where:{ coachId:c.id }, update:{ balance:start, season }, create:{ coachId:c.id, balance:start, season } });
      await interaction.reply(`Reset ${coaches.length} wallets to DIC$ ${start} for Season ${season}.`); return;
    }
    if (sub==="linessync"){
      const docId = process.env.GOOGLE_SHEET_ID!;
      const email = process.env.GOOGLE_SERVICE_EMAIL!;
      const key = process.env.GOOGLE_SERVICE_PRIVATE_KEY!;
      const tab = process.env.SHEET_TAB_LINES || "Lines";
      if (!docId||!email||!key){ await interaction.reply({ content:"Missing Google Sheets env vars.", ephemeral:true }); return; }
      const doc = await loadSheet(docId, email, key);
      const sheet = doc.sheetsByTitle[tab];
      if (!sheet){ await interaction.reply({ content:`Lines tab '${tab}' not found.`, ephemeral:true }); return; }
      await sheet.loadHeaderRow();
      const rows = await sheet.getRows();
      let count=0;
      for (const r of rows){
        const season = Number(r.get("Season") || 1);
        const week = Number(r.get("Week") || 1);
        const homeTeam = String(r.get("HomeTeam") || "").trim();
        const awayTeam = String(r.get("AwayTeam") || "").trim();
        if (!homeTeam || !awayTeam) continue;
        const spread = r.get("Spread")!==undefined && r.get("Spread")!=="" ? Number(r.get("Spread")) : null;
        const total = r.get("Total")!==undefined && r.get("Total")!=="" ? Number(r.get("Total")) : null;
        const homeML = r.get("HomeML")!==undefined && r.get("HomeML")!=="" ? Number(r.get("HomeML")) : null;
        const awayML = r.get("AwayML")!==undefined && r.get("AwayML")!=="" ? Number(r.get("AwayML")) : null;
        const cutoffStr = (r.get("CutoffUtc") || "").toString().trim();
        const cutoff = cutoffStr ? new Date(cutoffStr) : null;
        await prisma.line.create({ data:{ season, week, homeTeam, awayTeam, spread: spread as any, total: total as any, homeML: homeML as any, awayML: awayML as any, cutoff: cutoff as any } });
        count++;
      }
      await interaction.reply(`Imported ${count} lines from Sheet.`); return;
    }
  }
} as const;
