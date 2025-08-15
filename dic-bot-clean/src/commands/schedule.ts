// src/commands/schedule.ts
import { SlashCommandBuilder, type ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { getWeekSchedule } from '../lib/schedules';

/** ---------- Team canonicalization & display helpers ---------- */
// Clean things like "TCU (jak1741)" -> "TCU"
function sanitizeTeam(raw: string) {
  return String(raw ?? '').replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+/g, ' ').trim();
}

// Map common short forms to a single canonical key (lowercase)
const TEAM_ALIASES: Record<string, string> = {
  'pitt': 'pittsburgh',
  'penn st': 'penn state',
  'miss state': 'mississippi state',
  'oklahoma st': 'oklahoma state',
  'kansas st': 'kansas state',
  'nc state': 'north carolina state',
  // add more as needed
};

// Preferred display names for canonical keys
const DISPLAY_NAME: Record<string, string> = {
  'pittsburgh': 'Pittsburgh',
  'penn state': 'Penn State',
  'mississippi state': 'Mississippi State',
  'oklahoma state': 'Oklahoma State',
  'kansas state': 'Kansas State',
  'north carolina state': 'NC State',
};

function canonTeam(raw: string) {
  const s = sanitizeTeam(raw).replace(/\./g, '').toLowerCase();
  if (TEAM_ALIASES[s]) return TEAM_ALIASES[s];
  if (s.endsWith(' st')) return s.replace(/ st$/, ' state'); // generic St.→State
  return s;
}

function pretty(raw: string) {
  const c = canonTeam(raw);
  return DISPLAY_NAME[c] ?? sanitizeTeam(raw);
}

// Order-insensitive matchup key (so "Pitt vs Hawaii" == "Hawaii vs Pittsburgh")
function matchupKey(a: string, b: string) {
  const A = canonTeam(a), B = canonTeam(b);
  return A < B ? `${A}::${B}` : `${B}::${A}`;
}
/** ------------------------------------------------------------ */

export const command = {
  data: new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Show the week schedule: remaining and played')
    .addIntegerOption(o => o.setName('season').setDescription('Season').setRequired(true))
    .addIntegerOption(o => o.setName('week').setDescription('Week').setRequired(true)),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const season = interaction.options.getInteger('season', true);
    const week = interaction.options.getInteger('week', true);

    // Pull raw lists
    const { played, remaining } = await getWeekSchedule(season, week);

    // Build a set of played matchups (canon key) and filter out from remaining
    const playedSet = new Set<string>(
      played.map((g: any) => matchupKey(g.homeTeam, g.awayTeam))
    );

    const remainingFiltered = (remaining as any[]).filter(
      g => !playedSet.has(matchupKey(g.homeTeam, g.awayTeam))
    );

    // Pretty-up names for display (without mutating originals)
    const prettify = (g: any) => ({
      ...g,
      homeTeam: pretty(g.homeTeam),
      awayTeam: pretty(g.awayTeam),
    });

    const playedPretty = (played as any[]).map(prettify);
    const remainingPretty = remainingFiltered.map(prettify);

    // Render lines (keeps your home-first order)
    const lines = (arr: any[]) =>
      arr.length
        ? arr.map((g: any) =>
            g.status === 'confirmed'
              ? `✅ **${g.homeTeam} ${g.homePts} — ${g.awayTeam} ${g.awayPts}**`
              : `⏳ ${g.homeTeam} vs ${g.awayTeam}`
          ).join('\n')
        : '_None_';

    const embed = new EmbedBuilder()
      .setTitle(`Season ${season} — Week ${week} Schedule`)
      .addFields(
        { name: `Remaining (${remainingPretty.length})`, value: lines(remainingPretty) },
        { name: `Played (${playedPretty.length})`, value: lines(playedPretty) },
      );

    await interaction.editReply({ embeds: [embed] });
  },
} as const;
