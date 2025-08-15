// src/commands/powerrankings.ts
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** --- Canon helpers (keep in sync with schedule/postscore) --- */
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
const DISPLAY_NAME: Record<string, string> = {
  'pittsburgh': 'Pittsburgh',
  'penn state': 'Penn State',
  'mississippi state': 'Mississippi State',
  'oklahoma state': 'Oklahoma State',
  'kansas state': 'Kansas State',
  'north carolina state': 'NC State',
};
function pretty(name: string) {
  const c = canonTeam(name);
  return DISPLAY_NAME[c] ?? sanitizeTeam(name);
}
/** ----------------------------------------------------------- */

type Row = {
  team: string;
  gp: number;
  w: number;
  l: number;
  t: number;
  pf: number;
  pa: number;
  diff: number;
  score: number;
};

export const command = {
  data: new SlashCommandBuilder()
    .setName('powerrankings')
    .setDescription('Show power rankings for a season')
    .addIntegerOption(o => o.setName('season').setDescription('Season').setRequired(true))
    .addIntegerOption(o => o.setName('through_week').setDescription('Include games up to this week (optional)')),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const season = interaction.options.getInteger('season', true);
    const throughWeek = interaction.options.getInteger('through_week') ?? undefined;

    // 1) Seed with ALL teams from Coaches so 0–0 teams show up
    const coaches = await prisma.coach.findMany({ select: { team: true } });
    const teams = new Map<string, Row>();
    for (const c of coaches) {
      const key = canonTeam(c.team);
      if (!key) continue;
      if (!teams.has(key)) {
        teams.set(key, {
          team: pretty(c.team),
          gp: 0, w: 0, l: 0, t: 0, pf: 0, pa: 0, diff: 0, score: 0,
        });
      }
    }

    // 2) Overlay played games (confirmed). Include <= week if provided.
    const games = await prisma.game.findMany({
      where: {
        season,
        status: 'confirmed', // adjust if enum case differs
        ...(throughWeek ? { week: { lte: throughWeek } } : {}),
      },
      select: { homeTeam: true, awayTeam: true, homePts: true, awayPts: true },
    });

    function ensure(teamName: string) {
      const key = canonTeam(teamName);
      if (!teams.has(key)) {
        teams.set(key, {
          team: pretty(teamName),
          gp: 0, w: 0, l: 0, t: 0, pf: 0, pa: 0, diff: 0, score: 0,
        });
      }
      return teams.get(key)!;
    }

    for (const g of games) {
      const h = ensure(g.homeTeam);
      const a = ensure(g.awayTeam);
      const hs = g.homePts ?? 0;
      const as = g.awayPts ?? 0;

      h.gp++; a.gp++;
      h.pf += hs; h.pa += as;
      a.pf += as; a.pa += hs;

      if (hs > as) { h.w++; a.l++; }
      else if (hs < as) { a.w++; h.l++; }
      else { h.t++; a.t++; }

      h.diff = h.pf - h.pa;
      a.diff = a.pf - a.pa;
    }

    // 3) Scoring model (simple, tweak as needed)
    for (const r of teams.values()) {
      r.score = r.w * 3 + r.t * 1 + r.diff * 0.01; // wins heavy, point diff light
    }

    // 4) Rank & render
    const rows = Array.from(teams.values())
      .sort((a, b) => b.score - a.score || b.diff - a.diff || b.pf - a.pf || a.team.localeCompare(b.team));

    const list = rows.map((r, i) =>
      `**${i + 1}. ${r.team}** — ${r.w}-${r.l}${r.t ? '-' + r.t : ''} (PF ${r.pf} / PA ${r.pa} / Diff ${r.diff})`
    );

    const title = throughWeek
      ? `Season ${season} Power Rankings (through Week ${throughWeek})`
      : `Season ${season} Power Rankings`;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(list.join('\n'))
      .setFooter({ text: `Teams ranked: ${rows.length}` });

    await interaction.editReply({ embeds: [embed] });
  },
} as const;
