import { SlashCommandBuilder } from "discord.js";
import { PrismaClient } from "@prisma/client";
import { loadSheet } from "../lib/sheets.js";
const prisma = new PrismaClient();
const ALLOWED = new Set(["ACC","Big Ten","Big 12","Pac 12","SEC"]);
export const command = {
  adminOnly: true,
  data: new SlashCommandBuilder().setName("adminconf").setDescription("Conference admin").addSubcommand(sc=>sc.setName("sync").setDescription("Sync Conferences from Google Sheet 'Conferences' tab")),
  async execute(interaction:any){
    if (!interaction.memberPermissions?.has("Administrator")){ await interaction.reply({ content:"Admin only.", ephemeral:true }); return; }
    const docId = process.env.GOOGLE_SHEET_ID!;
    const email = process.env.GOOGLE_SERVICE_EMAIL || process.env.GOOGLE_CLIENT_EMAIL;
    const key = process.env.GOOGLE_SERVICE_PRIVATE_KEY || process.env.GOOGLE_PRIVATE_KEY;
    if (!docId || !email || !key){ await interaction.reply({ content:"Missing Google Sheets env vars.", ephemeral:true }); return; }
    const doc = await loadSheet(docId, email, key);
    const sheet = doc.sheetsByTitle["Conferences"];
    if (!sheet){ await interaction.reply({ content:"No 'Conferences' tab found.", ephemeral:true }); return; }
    await sheet.loadHeaderRow();
    const rows = await sheet.getRows();
    let updated=0, missing=0, bad=0;
    for (const r of rows){
      const team = (r.get("Team") || r.get("Team Name") || "").toString().trim();
      const conf = (r.get("Conference") || "").toString().trim();
      if (!team || !conf){ bad++; continue; }
      if (!ALLOWED.has(conf)){ bad++; continue; }
      const coach = await prisma.coach.findFirst({ where:{ team: { equals: team, mode:"insensitive" } } });
      if (!coach){ missing++; continue; }
      await prisma.coach.update({ where:{ id: coach.id }, data:{ conference: conf } });
      updated++;
    }
    await interaction.reply(`Conference sync done: updated ${updated}, missing-team ${missing}, invalid ${bad}.`);
  }
} as const;
