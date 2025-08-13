import { SlashCommandBuilder } from "discord.js";
import { PrismaClient } from "@prisma/client";
import type { SlashCommand } from "./_types.js";
import { loadSheet } from "../lib/sheets.js";

const prisma = new PrismaClient();

export const command: SlashCommand = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName("admin")
    .setDescription("Admin commands")
    .addSubcommand(sc => sc.setName("advance").setDescription("Advance week (locks previous)."))
    .addSubcommand(sc => sc.setName("setresult")
      .setDescription("Manually set a result")
      .addUserOption(o => o.setName("home").setDescription("Home coach").setRequired(true))
      .addUserOption(o => o.setName("away").setDescription("Away coach").setRequired(true))
      .addIntegerOption(o => o.setName("homepts").setDescription("Home points").setRequired(true))
      .addIntegerOption(o => o.setName("awaypts").setDescription("Away points").setRequired(true))
      .addIntegerOption(o => o.setName("season").setDescription("Season").setRequired(true))
      .addIntegerOption(o => o.setName("week").setDescription("Week").setRequired(true)))
    .addSubcommand(sc => sc.setName("toggle")
      .setDescription("Toggle spice/learning")
      .addStringOption(o => o.setName("spice").setDescription("pg|pg13|r").setRequired(false))
      .addBooleanOption(o => o.setName("learn").setDescription("Enable banter learning").setRequired(false)))
    .addSubcommand(sc => sc.setName("sync").setDescription("Sync Coaches & Results from Google Sheet")),
  async execute(interaction) {
    if (!interaction.memberPermissions?.has("Administrator")) {
      await interaction.reply({ content: "Admin only.", ephemeral: true });
      return;
    }

    const sub = interaction.options.getSubcommand();
    if (sub === "advance") {
      await interaction.reply("Advanced. Previous week locked (placeholder).");
      return;
    }

    if (sub === "setresult") {
      const home = interaction.options.getUser("home", true);
      const away = interaction.options.getUser("away", true);
      const homepts = interaction.options.getInteger("homepts", true);
      const awaypts = interaction.options.getInteger("awaypts", true);
      const season = interaction.options.getInteger("season", true);
      const week = interaction.options.getInteger("week", true);

      const h = await prisma.coach.findUnique({ where: { discordId: home.id } });
      const a = await prisma.coach.findUnique({ where: { discordId: away.id } });
      if (!h?.team || !a?.team) { await interaction.reply("Both coaches must have teams."); return; }

      await prisma.game.upsert({
        where: { season_week_homeCoachId_awayCoachId: { season, week, homeCoachId: h.id, awayCoachId: a.id } },
        update: { homePts: homepts, awayPts: awaypts, status: "confirmed", confirmedById: h.id },
        create: { season, week, homeCoachId: h.id, awayCoachId: a.id, homeTeam: h.team, awayTeam: a.team, homePts: homepts, awayPts: awaypts, status: "confirmed", reportedById: h.id, confirmedById: h.id }
      });

      await interaction.reply(`Set: ${h.team} ${homepts}–${awaypts} ${a.team}`);
      return;
    }

    if (sub === "toggle") {
      const spice = interaction.options.getString("spice") as "pg"|"pg13"|"r" | null;
      const learn = interaction.options.getBoolean("learn");
      const cfg = await prisma.config.upsert({
        where: { id: 1 },
        update: { spiceLevel: spice || undefined, allowLearn: learn ?? undefined },
        create: { id: 1, spiceLevel: spice || "pg13", allowLearn: learn ?? true }
      });
      await interaction.reply(`Config updated: spice=${cfg.spiceLevel}, learn=${cfg.allowLearn}`);
      return;
    }

    if (sub === "sync") {
      const docId = process.env.GOOGLE_SHEET_ID!;
      const email = process.env.GOOGLE_SERVICE_EMAIL!;
      const key = process.env.GOOGLE_SERVICE_PRIVATE_KEY!;
      const tabCoaches = process.env.SHEET_TAB_COACHES || "Coaches";
      const tabResults = process.env.SHEET_TAB_RESULTS || "Results";

      if (!docId || !email || !key) {
        await interaction.reply({ content: "Missing Google Sheets env vars.", ephemeral: true });
        return;
      }

      const doc = await loadSheet(docId, email, key);
      const shCoaches = doc.sheetsByTitle[tabCoaches];
      const shResults = doc.sheetsByTitle[tabResults];
      if (!shCoaches || !shResults) {
        await interaction.reply({ content: `Tabs not found: ${tabCoaches}, ${tabResults}`, ephemeral: true });
        return;
      }

      await shCoaches.loadHeaderRow();
      await shResults.loadHeaderRow();
      const rowsC = await shCoaches.getRows();
      const rowsR = await shResults.getRows();

      // Coaches sheet columns: DiscordId (optional), Handle, Team, Conference
      let coachCount = 0;
      for (const r of rowsC) {
        const handle = (r.get("Handle") || "").toString().trim();
        const team = (r.get("Team") || "").toString().trim();
        const conference = (r.get("Conference") || "").toString().trim() || undefined;
        const discordId = (r.get("DiscordId") || "").toString().trim() || `sheet:${handle}`;
        if (!handle || !team) continue;
        await prisma.coach.upsert({
          where: { discordId },
          update: { handle, team, conference },
          create: { discordId, handle, team, conference }
        });
        coachCount++;
      }

      // Results sheet columns: Season, Week, HomeTeam, AwayTeam, HomePts, AwayPts
      let gameCount = 0;
      for (const r of rowsR) {
        const season = Number(r.get("Season") || 1);
        const week = Number(r.get("Week") || 1);
        const homeTeam = (r.get("HomeTeam") || "").toString().trim();
        const awayTeam = (r.get("AwayTeam") || "").toString().trim();
        const homePts = Number(r.get("HomePts") || 0);
        const awayPts = Number(r.get("AwayPts") || 0);
        if (!homeTeam || !awayTeam) continue;

        const h = await prisma.coach.findFirst({ where: { team: { equals: homeTeam, mode: "insensitive" } } });
        const a = await prisma.coach.findFirst({ where: { team: { equals: awayTeam, mode: "insensitive" } } });
        if (!h || !a) continue;

        await prisma.game.upsert({
          where: { season_week_homeCoachId_awayCoachId: { season, week, homeCoachId: h.id, awayCoachId: a.id } },
          update: { homePts, awayPts, status: "confirmed", confirmedById: h.id },
          create: { season, week, homeCoachId: h.id, awayCoachId: a.id, homeTeam, awayTeam, homePts, awayPts, status: "confirmed", reportedById: h.id, confirmedById: h.id }
        });
        gameCount++;
      }

      await interaction.reply(`Sync complete: ${coachCount} coaches, ${gameCount} results.`);
      return;
    }
  }
}
