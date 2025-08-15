// src/commands/postscore.ts
import { SlashCommandBuilder, type ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { settleWagersForGame } from '../lib/settle'; // ✅ import at top

const prisma = new PrismaClient();

export const command = {
  data: new SlashCommandBuilder()
    .setName('postscore')
    .setDescription('Report a final score')
    .addIntegerOption(o => o.setName('season').setDescription('Season').setRequired(true))
    .addIntegerOption(o => o.setName('week').setDescription('Week').setRequired(true))
    .addStringOption(o => o.setName('home').setDescription('Home team').setRequired(true))
    .addIntegerOption(o => o.setName('home_pts').setDescription('Home points').setRequired(true))
    .addStringOption(o => o.setName('away').setDescription('Away team').setRequired(true))
    .addIntegerOption(o => o.setName('away_pts').setDescription('Away points').setRequired(true)),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const season = interaction.options.getInteger('season', true);
    const week = interaction.options.getInteger('week', true);
    const homeTeam = interaction.options.getString('home', true).trim();
    const awayTeam = interaction.options.getString('away', true).trim();
    const homePts = interaction.options.getInteger('home_pts', true);
    const awayPts = interaction.options.getInteger('away_pts', true);

    // Look up coaches by team name (or however you store them)
    const homeCoach = await prisma.coach.findFirst({ where: { team: homeTeam } });
    const awayCoach = await prisma.coach.findFirst({ where: { team: awayTeam } });
    if (!homeCoach || !awayCoach) {
      await interaction.editReply('❌ Could not find one or both teams in the database. Use /setteam first.');
      return;
    }

    // Create the game ONCE
    const created = await prisma.game.create({
      data: {
        season,
        week,
        homeCoachId: homeCoach.id,
        awayCoachId: awayCoach.id,
        homeTeam,
        awayTeam,
        homePts,
        awayPts,
        status: 'confirmed' as any,
      },
    });

    // Nice confirmation embed
    const embed = new EmbedBuilder()
      .setTitle(`Final: ${homeTeam} ${homePts} — ${awayTeam} ${awayPts}`)
      .setDescription(`Season ${season}, Week ${week}`)
      .setColor(homePts > awayPts ? 0x2ecc71 : (homePts < awayPts ? 0xe74c3c : 0x95a5a6));

    await interaction.editReply({ embeds: [embed] });

    // ✅ Auto-settle wagers for this game (ONE call, no redeclare)
    try {
      await settleWagersForGame(created.id);
      // Optional: follow-up message to confirm settlement ran
      // await interaction.followUp({ content: `🧾 Settled wagers for Game #${created.id}`, ephemeral: true });
    } catch (e) {
      console.error('[settle] failed to settle wagers:', e);
    }
  },
} as const;
