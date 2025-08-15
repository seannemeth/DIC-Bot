// src/commands/postscore.ts
import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  TextChannel,
} from 'discord.js';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

function computeRecords(games: any[], coachesById: Map<number, any>) {
  type Rec = { id:number; team:string; w:number;l:number;t:number; pf:number; pa:number; diff:number };
  // Initialize table with every coach
  const allCoaches = Array.from(coachesById.values());
  const table: Rec[] = allCoaches.map((c:any) => ({
    id: c.id, team: c.team || c.handle, w:0,l:0,t:0, pf:0, pa:0, diff:0
  }));
  const byId = new Map<number, Rec>(table.map(r => [r.id, r]));

  for (const g of games) {
    if (g.homePts == null || g.awayPts == null) continue;
    const h = byId.get(g.homeCoachId)!;
    const a = byId.get(g.awayCoachId)!;
    h.pf += g.homePts; h.pa += g.awayPts; h.diff += g.homePts - g.awayPts;
    a.pf += g.awayPts; a.pa += g.homePts; a.diff += g.awayPts - g.homePts;
    if (g.homePts > g.awayPts) { h.w++; a.l++; }
    else if (g.homePts < g.awayPts) { a.w++; h.l++; }
    else { h.t++; a.t++; }
  }

  // Sort by win%, then diff, then PF-PA
  return table.sort((x, y) => {
    const wx = x.w + x.l + x.t ? (x.w + 0.5 * x.t) / (x.w + x.l + x.t) : 0;
    const wy = y.w + y.l + y.t ? (y.w + 0.5 * y.t) / (y.w + y.l + y.t) : 0;
    if (wy !== wx) return wy - wx;
    if (y.diff !== x.diff) return y.diff - x.diff;
    return (y.pf - y.pa) - (x.pf - x.pa);
  });
}

async function buildStandingsEmbed() {
  const [coaches, games] = await Promise.all([
    prisma.coach.findMany(),
    prisma.game.findMany({ where: { status: 'confirmed' } }),
  ]);
  const coachesById = new Map<number, any>(coaches.map(c => [c.id, c]));
  const sorted = computeRecords(games, coachesById);
  const top = sorted.slice(0, 10);
  const lines = top.map((r, i) =>
    `**${i + 1}. ${r.team}** ${r.w}-${r.l}${r.t ? '-' + r.t : ''} (Diff ${r.diff})`
  );
  return new EmbedBuilder()
    .setTitle('📈 DIC Standings (Top 10)')
    .setDescription(lines.join('\n') || 'No data yet.')
    .setColor(0x3498db);
}

export const command = {
  data: new SlashCommandBuilder()
    .setName('postscore')
    .setDescription('Report a final score (saved immediately; can auto-post updated standings)')
    .addUserOption(o =>
      o.setName('opponent').setDescription('Tag your opponent').setRequired(true),
    )
    .addIntegerOption(o =>
      o.setName('your_score').setDescription('Your points').setRequired(true),
    )
    .addIntegerOption(o =>
      o.setName('their_score').setDescription("Opponent's points").setRequired(true),
    )
    .addIntegerOption(o =>
      o.setName('season').setDescription('Season number (default 1)').setRequired(false),
    )
    .addIntegerOption(o =>
      o.setName('week').setDescription('Week number (default 1)').setRequired(false),
    )
    .addBooleanOption(o =>
      o.setName('announce').setDescription('Also post updated standings to the channel').setRequired(false),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const reporterId = interaction.user.id;
    const oppUser = interaction.options.getUser('opponent', true);
    const yourScore = interaction.options.getInteger('your_score', true);
    const theirScore = interaction.options.getInteger('their_score', true);
    const season = interaction.options.getInteger('season') ?? 1;
    const week = interaction.options.getInteger('week') ?? 1;
    const announce = interaction.options.getBoolean('announce') ?? false;

    // Find both coaches
    const [homeCoach, awayCoach] = await Promise.all([
      prisma.coach.findUnique({ where: { discordId: reporterId } }),
      prisma.coach.findUnique({ where: { discordId: oppUser.id } }),
    ]);

    if (!homeCoach || !awayCoach) {
      await interaction.reply({
        content:
          '❌ Could not find both coaches in the DB. Make sure both have run `/setteam` first.',
        flags: 64,
      });
      return;
    }

    const homeTeam = homeCoach.team ?? homeCoach.handle;
    const awayTeam = awayCoach.team ?? awayCoach.handle;
    const homePts = yourScore;
    const awayPts = theirScore;

    try {
      const game = await prisma.game.create({
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
import { settleWagersForGame } from '../lib/settle';

// ... inside execute(), AFTER creating `game` ...
const game = await prisma.game.create({ data: {
  season, week,
  homeCoachId: homeCoach.id,
  awayCoachId: awayCoach.id,
  homeTeam, awayTeam,
  homePts, awayPts,
  status: 'confirmed' as any,
}});

// Auto-settle wagers for this matchup
try {
  await settleWagersForGame(game.id);
} catch (e) {
  console.error('[settle] failed to settle wagers:', e);
}
      // Optional: coin award (winner +500)
      if (homePts !== awayPts) {
        const winnerId = awayPts > homePts ? awayCoach.id : homeCoach.id;
        await prisma.wallet.upsert({
          where: { coachId: winnerId },
          create: { coachId: winnerId, balance: 500 },
          update: { balance: { increment: 500 } },
        });
      }

      const saved = new EmbedBuilder()
        .setTitle('✅ Score Recorded')
        .setDescription(`**${homeTeam}** ${homePts} — ${awayPts} **${awayTeam}**\nSeason ${season}, Week ${week}`)
        .setFooter({ text: `Game ID ${game.id}` })
        .setColor(0x2ecc71);

      await interaction.reply({ embeds: [saved] });

      // Auto-post standings snapshot if requested
      if (announce) {
        const channelId = process.env.STANDINGS_CHANNEL_ID;
        const embed = await buildStandingsEmbed();
        if (channelId) {
          const channel = interaction.client.channels.cache.get(channelId) as TextChannel | undefined;
          if (channel) {
            await channel.send({ embeds: [embed] });
          } else {
            // fallback: post to current channel
            await (interaction.channel as TextChannel).send({ embeds: [embed] });
          }
        } else {
          // No env configured: post to current channel
          await (interaction.channel as TextChannel).send({ embeds: [embed] });
        }
      }
    } catch (err) {
      console.error('[postscore] error:', err);
      await interaction.reply({
        content: '⚠️ Something went wrong saving the score. Try again.',
        flags: 64,
      });
    }
  },
} as const;
