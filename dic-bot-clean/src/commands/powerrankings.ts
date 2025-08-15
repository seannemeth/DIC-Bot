import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { computePowerRankings } from '../lib/power';

export const command = {
  data: new SlashCommandBuilder()
    .setName('powerrankings')
    .setDescription('Show DIC Power Rankings (wins, MOV, opponent strength, recursive)')
    .addIntegerOption(o =>
      o.setName('season').setDescription('Filter by season number').setRequired(false),
    )
    .addIntegerOption(o =>
      o.setName('max_week').setDescription('Use games up to this week (inclusive)').setRequired(false),
    )
    .addIntegerOption(o =>
      o.setName('top').setDescription('How many teams to show (default 25)').setRequired(false),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const season = interaction.options.getInteger('season');
    const maxWeek = interaction.options.getInteger('max_week');
    const topN = interaction.options.getInteger('top') ?? 25;

    // You can tune weights here or via env if you prefer
    const rows = await computePowerRankings({
      season: season ?? null,
      maxWeek: maxWeek ?? null,
      winPoints: 1.0,
      lossPoints: -1.0,
      tiePoints: 0.0,
      movFactor: 0.05,  // 20-0 adds ~1.0 points before normalization
      movCap: 28,       // cap blowouts
      oppFactor: 0.20,  // how much opponent rating matters
      iterations: 20,   // recursive strength propagation
    });

    const top = rows.slice(0, Math.max(1, topN));
    const lines = top.map((r, i) => `**${i + 1}. ${r.team}** — ${r.rating.toFixed(3)}`);

    const titleParts = ['🏆 DIC Power Rankings'];
    if (season != null) titleParts.push(`S${season}`);
    if (maxWeek != null) titleParts.push(`Wk≤${maxWeek}`);

    const embed = new EmbedBuilder()
      .setTitle(titleParts.join(' · '))
      .setDescription(lines.join('\n') || 'No games found.')
      .setFooter({ text: 'Formula: W/L + MOV (capped) + OppStrength (recursive); no decay' })
      .setColor(0x9b59b6);

    await interaction.editReply({ embeds: [embed] });
  },
} as const;
