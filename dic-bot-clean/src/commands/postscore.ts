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
import { PrismaClient } from '@prisma/client';
import { getWeekSchedule } from '../lib/schedules';

const prisma = new PrismaClient();

/** Lightweight shapes we use here (keeps TS happy without overfitting to DB types) */
type SchedGame = { homeTeam: string; awayTeam: string; status?: string; homePts?: number; awayPts?: number };
type DbGame = { id: number; homeTeam: string; awayTeam: string; homePts: number | null; awayPts: number | null; status: string };

// ---------- Canonicalization helpers (keep in this file or move to lib) ----------
function sanitizeTeam(raw: string) {
  return String(raw ?? '').replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+/g, ' ').trim();
}
const TEAM_ALIASES: Record<string, string> = {
  'pitt': 'pittsburgh',
  'penn st': 'penn state',
  'miss state': 'mississippi state',
  'oklahoma st': 'oklahoma state',
  'kansas st': 'kansas state',
  'nc state': 'north carolina state',
};
function canonTeam(raw: string) {
  const s = sanitizeTeam(raw).replace(/\./g, '').toLowerCase();
  if (TEAM_ALIASES[s]) return TEAM_ALIASES[s];
  if (s.endsWith(' st')) return s.replace(/ st$/, ' state');
  return s;
}
function matchupKey(a: string, b: string) {
  const A = canonTeam(a), B = canonTeam(b);
  return A < B ? `${A}::${B}` : `${B}::${A}`;
}
// -------------------------------------------------------------------------------

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

    // Get week schedule and filter out already-played using canonical keys
    const { played, remaining } = await getWeekSchedule(season, week);

    const playedSet = new Set<string>(
      (played as SchedGame[]).map((g: SchedGame) => matchupKey(g.homeTeam, g.awayTeam))
    );

    const remainingFiltered = (remaining as SchedGame[]).filter(
      (g: SchedGame) => !playedSet.has(matchupKey(g.homeTeam, g.awayTeam))
    );

    if (!remainingFiltered.length) {
      await interaction.editReply(`No remaining games for Season ${season}, Week ${week}.`);
      return;
    }

    // Build select menu (Discord max 25 options)
    const options = remainingFiltered.slice(0, 25).map((g: SchedGame) => {
      const label = `${sanitizeTeam(g.homeTeam)} vs ${sanitizeTeam(g.awayTeam)}`;
      const value = JSON.stringify({ s: season, w: week, h: g.homeTeam, a: g.awayTeam });
      return new StringSelectMenuOptionBuilder().setLabel(label).setValue(value);
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

// ---------- Interaction handlers exported for index.ts routing ----------

export async function handlePostScoreSelect(interaction: Interaction) {
  if (!interaction.isStringSelectMenu()) return;
  if (interaction.customId !== SELECT_ID) return;

  const [raw] = interaction.values;
  const payload = JSON.parse(raw) as { s: number; w: number; h: string; a: string };
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

    const season = payload.s;
    const week = payload.w;

    // Fetch games for week and match in JS by canonical key
    const games = await prisma.game.findMany({
      where: { season, week },
      select: {
        id: true,
        homeTeam: true,
        awayTeam: true,
        homePts: true,
        awayPts: true,
        status: true,
      },
    });

    const wantedKey = matchupKey(payload.h, payload.a);
    const game = (games as DbGame[]).find(
      (g: DbGame) => matchupKey(g.homeTeam, g.awayTeam) === wantedKey
    );

    if (!game) {
      await interaction.editReply(
        `❌ Couldn’t find: S${season} W${week} ${sanitizeTeam(payload.h)} vs ${sanitizeTeam(payload.a)}.`
      );
      return;
    }

    // Map entered scores to stored home/away order
    const storedHomeIsPayloadHome =
      canonTeam(game.homeTeam) === canonTeam(payload.h) &&
      canonTeam(game.awayTeam) === canonTeam(payload.a);

    const nextHomePts = storedHomeIsPayloadHome ? homePts : awayPts;
    const nextAwayPts = storedHomeIsPayloadHome ? awayPts : homePts;

    const updated = await prisma.game.update({
      where: { id: game.id },
      data: {
        homePts: nextHomePts,
        awayPts: nextAwayPts,
        status: 'confirmed' as any, // cast if your schema type is stricter
        // played: true, // uncomment if you track a played boolean
      },
      select: { homeTeam: true, awayTeam: true, homePts: true, awayPts: true },
    });

    await interaction.editReply(
      `✅ Score posted: **${sanitizeTeam(updated.homeTeam)} ${updated.homePts} — ${sanitizeTeam(updated.awayTeam)} ${updated.awayPts}**`
    );
  } catch (err: any) {
    console.error('[postscore modal] failed:', err);
    await interaction.editReply(`❌ Posting score failed: ${err?.message || err}`);
  }
}
