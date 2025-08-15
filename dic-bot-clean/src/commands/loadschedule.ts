import { SlashCommandBuilder, type ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { getCurrentSeasonWeek } from '../lib/meta';
import { readScheduleTab } from '../lib/sheetsSchedule';

const prisma = new PrismaClient();

async function resolveCoachId(opts: { team?: string | null; discordId?: string | null }) {
  const { team, discordId } = opts;
  if (discordId) {
    const c = await prisma.coach.findUnique({ where: { discordId } });
    if (c) return c.id;
  }
  if (team) {
    const c = await prisma.coach.findFirst({ where: { team } });
    if (c) return c.id;
  }
  return null;
}

export const command = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName('loadschedule')
    .setDescription('Load a week’s schedule from a Google Sheet tab (Schedule_S{season}W{week})')
    .addIntegerOption(o => o.setName('season').setDescription('Season (optional; uses /setweek if omitted)'))
    .addIntegerOption(o => o.setName('week').setDescription('Week (optional; uses /setweek if omitted)'))
    .addStringOption(o => o.setName('tab').setDescription('Override tab name (e.g., Schedule_S1W3)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const meta = await getCurrentSeasonWeek();
    const season = interaction.options.getInteger('season') ?? meta.season ?? undefined;
    const week = interaction.options.getInteger('week') ?? meta.week ?? undefined;
    const tabOverride = interaction.options.getString('tab') ?? undefined;

    if (!season || !week) {
      return interaction.editReply('❌ Provide season/week or set them via `/setweek`.');
    }

    const tabName = tabOverride || `Schedule_S${season}W${week}`;
    let rows: Array<{ home_team: string; away_team: string; home_discord_id: string; away_discord_id: string }>;
    try {
      rows = await readScheduleTab(tabName);
    } catch (e: any) {
      return interaction.editReply(`❌ Failed to read tab **${tabName}**: ${e?.message || e}`);
    }
    if (!rows.length) {
      return interaction.editReply(`❌ No rows found in **${tabName}**.`);
    }

    let created = 0, updated = 0, skipped = 0;
    for (const r of rows) {
      if (!r.home_team && !r.home_discord_id) { skipped++; continue; }
      if (!r.away_team && !r.away_discord_id) { skipped++; continue; }

      const homeId = await resolveCoachId({ team: r.home_team || null, discordId: r.home_discord_id || null });
      const awayId = await resolveCoachId({ team: r.away_team || null, discordId: r.away_discord_id || null });
      if (!homeId || !awayId) { skipped++; continue; }

      const exists = await prisma.game.findFirst({
        where: { season, week, homeCoachId: homeId, awayCoachId: awayId }
      });

      if (exists) {
        await prisma.game.update({
          where: { id: exists.id },
          data: {
            homeTeam: r.home_team || exists.homeTeam,
            awayTeam: r.away_team || exists.awayTeam,
          }
        });
        updated++;
      } else {
        await prisma.game.create({
          data: {
            season,
            week,
            homeCoachId: homeId,
            awayCoachId: awayId,
            homeTeam: r.home_team || 'Home',
            awayTeam: r.away_team || 'Away',
            status: 'pending',
          }
        });
        created++;
      }
    }

    await interaction.editReply(`✅ Loaded **${tabName}**. Created: ${created}, Updated: ${updated}, Skipped: ${skipped}.`);
  }
} as const;
