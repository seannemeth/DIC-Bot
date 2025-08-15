// src/commands/postscore.ts
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  ComponentType,
} from 'discord.js';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export const command = {
  data: new SlashCommandBuilder()
    .setName('postscore')
    .setDescription('Report a final score and confirm it')
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
      o
        .setName('season')
        .setDescription('Season number (default 1)')
        .setRequired(false),
    )
    .addIntegerOption(o =>
      o
        .setName('week')
        .setDescription('Week number (default 1)')
        .setRequired(false),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const reporterId = interaction.user.id;
    const oppUser = interaction.options.getUser('opponent', true);
    const yourScore = interaction.options.getInteger('your_score', true);
    const theirScore = interaction.options.getInteger('their_score', true);
    const season = interaction.options.getInteger('season') ?? 1;
    const week = interaction.options.getInteger('week') ?? 1;

    // Resolve Coach rows (assumes Coach.discordId is unique)
    const [homeCoach, awayCoach] = await Promise.all([
      prisma.coach.findUnique({ where: { discordId: reporterId } }),
      prisma.coach.findUnique({ where: { discordId: oppUser.id } }),
    ]);

    if (!homeCoach || !awayCoach) {
      await interaction.reply({
        content:
          '❌ Could not find both coaches in the DB. Make sure both have run `/setteam` first.',
        flags: 64, // ephemeral
      });
      return;
    }

    const homeTeam = homeCoach.team ?? homeCoach.handle;
    const awayTeam = awayCoach.team ?? awayCoach.handle;
    const homePts = yourScore;
    const awayPts = theirScore;

    // Build buttons before replying
    // We'll defer update in the button handler to avoid "This interaction failed"
    const confirmId = `postscore_confirm_${Date.now()}_${reporterId}_${oppUser.id}`;
    const cancelId = `postscore_cancel_${Date.now()}_${reporterId}_${oppUser.id}`;

    const embed = new EmbedBuilder()
      .setTitle('📝 Score Submission (Pending Confirmation)')
      .setDescription(
        `**${homeTeam}** ${homePts} — ${awayPts} **${awayTeam}**\n\n` +
          `Submitted by: <@${reporterId}> • Opponent: <@${oppUser.id}>\n` +
          `Season ${season}, Week ${week}`,
      )
      .setColor(0x3498db);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(confirmId)
        .setLabel('Confirm')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(cancelId)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Danger),
    );

    // Reply immediately (ack slash command)
    const msg = await interaction.reply({
      embeds: [embed],
      components: [row],
      fetchReply: true,
    });

    // Collector: only the two coaches can press; 60s timeout
    const filter = (i: ButtonInteraction) =>
      (i.customId === confirmId || i.customId === cancelId) &&
      (i.user.id === reporterId || i.user.id === oppUser.id);

    const collector = (msg as any).createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter,
      time: 60_000,
    });

    collector.on('collect', async (btn: ButtonInteraction) => {
      // Acknowledge button press right away
      await btn.deferUpdate();

      try {
        if (btn.customId === cancelId) {
          const cancelled = EmbedBuilder.from(embed)
            .setTitle('❌ Score Submission Cancelled')
            .setColor(0xe74c3c);
          await (msg as any).edit({ embeds: [cancelled], components: [] });
          collector.stop('cancelled');
          return;
        }

        // Confirm path: create the Game row with required fields for your schema
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
            status: 'confirmed' as any, // adjust if your enum differs
          },
        });

        // Optional: award coins to winner (comment out if not desired)
        if (homePts !== awayPts) {
          const winnerId = awayPts > homePts ? awayCoach.id : homeCoach.id;
          const loserId = awayPts > homePts ? homeCoach.id : awayCoach.id;

          await prisma.wallet.upsert({
            where: { coachId: winnerId },
            create: { coachId: winnerId, balance: 500 },
            update: { balance: { increment: 500 } },
          });
          await prisma.wallet.upsert({
            where: { coachId: loserId },
            create: { coachId: loserId, balance: 0 },
            update: {},
          });
        }

        const confirmed = EmbedBuilder.from(embed)
          .setTitle('✅ Score Confirmed')
          .setFooter({ text: `Game saved (ID ${game.id})` })
          .setColor(0x2ecc71);

        await (msg as any).edit({ embeds: [confirmed], components: [] });
        collector.stop('confirmed');
      } catch (err) {
        console.error('[postscore] confirm error:', err);
        await (msg as any).edit({
          content: '⚠️ Something went wrong finalizing this score. Try again.',
          components: [],
        });
        collector.stop('error');
      }
    });

    collector.on('end', async (_collected: any, reason: string) => {
      if (reason === 'time') {
        const expired = EmbedBuilder.from(embed)
          .setTitle('⌛ Confirmation Timed Out')
          .setColor(0xf1c40f);
        await (msg as any).edit({ embeds: [expired], components: [] });
      }
    });
  },
} as const;
