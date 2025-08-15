// src/commands/postscore.ts
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Interaction,
} from 'discord.js';
import { getWeekSchedule } from '../lib/schedules';
import { PrismaClient } from '@prisma/client';

// ===== If you already moved these to ../lib/teamNames, import instead =====
function sanitizeTeam(raw: string) {
  return String(raw ?? '').replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+/g, ' ').trim();
}
const TEAM_ALIASES: Record<string,string> = {
  'pitt':'pittsburgh','penn st':'penn state','miss state':'mississippi state',
  'oklahoma st':'oklahoma state','kansas st':'kansas state','nc state':'north carolina state',
};
function canonTeam(raw: string) {
  const s = sanitizeTeam(raw).replace(/\./g,'').toLowerCase();
  if (TEAM_ALIASES[s]) return TEAM_ALIASES[s];
  if (s.endsWith(' st')) return s.replace(/ st$/, ' state');
  return s;
}
function matchupKey(a: string, b: string) {
  const A = canonTeam(a), B = canonTeam(b);
  return A < B ? `${A}::${B}` : `${B}::${A}`;
}
// ========================================================================

const prisma = new PrismaClient();

// We’ll reuse this customId prefix to route interactions
const SELECT_ID = 'postscore_select';
const MODAL_ID_PREFIX = 'postscore_modal';

export const command = {
  data: new SlashCommandBuilder()
    .setName('postscore')
    .setDescription('Post a final score for a game this week')
    .addIntegerOption(o => o.setName('season').setDescription('Season').setRequired(true))
    .addIntegerOption(o => o.setName('week').setDescription('Week').setRequired(true)),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const season = interaction.options.getInteger('season', true);
    const week = interaction.options.getInteger('week', true);

    // Pull games and filter to Remaining (not confirmed) using canonical keys
    const { played, remaining } = await getWeekSchedule(season, week);
    const playedSet = new Set<string>(played.map((g: any) => matchupKey(g.homeTeam, g.awayTeam)));
    const remainingFiltered = (remaining as any[]).filter(
      g => !playedSet.has(matchupKey(g.homeTeam, g.awayTeam))
    );

    if (!remainingFiltered.length) {
      await interaction.editReply(`No remaining games for Season ${season}, Week ${week}.`);
      return;
    }

    // Discord select menus allow max 25 options
    const options = remainingFiltered.slice(0, 25).map((g: any) => {
      const label = `${sanitizeTeam(g.homeTeam)} vs ${sanitizeTeam(g.awayTeam)}`;
      // Encode just what we need; keep it short for customId/value limits
      const value = JSON.stringify({
        s: season, w: week,
        h: g.homeTeam, a: g.awayTeam
      });
      return new StringSelectMenuOptionBuilder()
        .setLabel(label)
        .setValue(value);
    });

    const menu = new StringSelectMenuBuilder()
      .setCustomId(SELECT_ID)
      .setPlaceholder('Choose a game to score…')
      .addOptions(options)
      .setMinValues(1)
      .setMaxValues(1);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);

    await interaction.editReply({
      content: `Season ${season} — Week ${week}\nSelect a game to post a score:`,
      components: [row],
    });
  },
} as const;

// ============= Interaction routing helpers (exported) =============

// Handle the select -> show modal
export async function handlePostScoreSelect(interaction: Interaction) {
  if (!interaction.isStringSelectMenu()) return;
  if (interaction.customId !== SELECT_ID) return;

  const [raw] = interaction.values;
  // Value length can be up to 100; keep payload tiny
  const payload = JSON.parse(raw) as { s: number; w: number; h: string; a: string; };
  const { s: season, w: week, h: homeTeam, a: awayTeam } = payload;

  const modal = new ModalBuilder()
    .setCustomId(`${MODAL_ID_PREFIX}:${Buffer.from(raw).toString('base64')}`)
    .setTitle(`Post Score — S${season} W${week}`);

  const home = new TextInputBuilder()
    .setCustomId('homePts')
    .setLabel(`${sanitizeTeam(homeTeam)} points`)
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const away = new TextInputBuilder()
    .setCustomId('awayPts')
    .setLabel(`${sanitizeTeam(awayTeam)} points`)
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  await interaction.showModal(
    modal
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(home),
        new ActionRowBuilder<TextInputBuilder>().addComponents(away),
      )
  );
}

// Handle modal submit -> write scores
export async function handlePostScoreModal(interaction: Interaction) {
  if (!interaction.isModalSubmit()) return;
  if (!interaction.customId.startsWith(`${MODAL_ID_PREFIX}:`)) return;

  await interaction.deferReply({ ephemeral: true });

  try {
    const b64 = interaction.customId.split(':', 2)[1]!;
    const payload = JSON.parse(Buffer.from(b64, 'base64').toString()) as {
      s: number; w: number; h: string; a: string;
    };
    const homePts = parseInt(interaction.fields.getTextInputValue('homePts'), 10);
    const awayPts = parseInt(interaction.fields.getTextInputValue('awayPts'), 10);

    if (!Number.isFinite(homePts) || !Number.isFinite(awayPts) || homePts < 0 || awayPts < 0) {
      await interaction.editReply('❌ Enter non-negative integers for both scores.');
      return;
    }

    // Find the game by canonical teams (or swap for your actual primary key if you store game.id)
    const season = payload.s;
    const week = payload.w;
    const homeKey = canonTeam(payload.h);
    const awayKey = canonTeam(payload.a);

    // Try both home/away orders just in case data stores the reverse
    const game = await prisma.game.findFirst({
      where: {
        season, week,
        OR: [
          { homeTeamKey: homeKey, awayTeamKey: awayKey },
          { homeTeamKey: awayKey, awayTeamKey: homeKey },
        ],
      },
    });

    if (!game) {
      await interaction.editReply(`❌ Couldn’t find the game record: S${season} W${week} ${sanitizeTeam(payload.h)} vs ${sanitizeTeam(payload.a)}.`);
      return;
    }

    // Update game — adjust field names to your schema
    const updated = await prisma.game.update({
      where: { id: game.id },
      data: {
        homeTeam: game.homeTeamKey === homeKey ? payload.h : payload.a,
        awayTeam: game.homeTeamKey === homeKey ? payload.a : payload.h,
        homeScore: game.homeTeamKey === homeKey ? homePts : awayPts,
        awayScore: game.homeTeamKey === homeKey ? awayPts : homePts,
        status: 'confirmed',
        played: true,
      },
    });

    await interaction.editReply(
      `✅ Score posted: **${sanitizeTeam(updated.homeTeam)} ${updated.homeScore} — ${sanitizeTeam(updated.awayTeam)} ${updated.awayScore}**`
    );
  } catch (err: any) {
    console.error('[postscore modal] failed:', err);
    await interaction.editReply(`❌ Posting score failed: ${err?.message || err}`);
  }
}
