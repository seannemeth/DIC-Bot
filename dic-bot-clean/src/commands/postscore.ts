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
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const reporterId = interaction.user.id;
    const oppUser = interaction.options.getUser('opponent', true);
    const yourScore = interaction.options.getInteger('your_score', true);
    const theirScore = interaction.options.getInteger('their_score', true);

    // Figure out which side is home/away based on who reports (customize if you prefer fixed home/away)
    const homeCoachDiscordId = reporterId;
    const awayCoachDiscordId = oppUser.id;
    const homePts = yourScore;
    const awayPts = theirScore;

    // Resolve Coach rows (assumes Coach.discordId is unique)
    const [homeCoach, awayCoach] = await Promise.all([
      prisma.coach.findUnique({ where: { discordId: homeCoachDiscordId } }),
      prisma.coach.findUnique({ where: { discordId: awayCoachDiscordId } }),
    ]);

    if (!homeCoach || !awayCoach) {
      await interaction.reply({
        content:
          '❌ Could not find both coaches in the DB. Make sure both have run `/setteam` first.',
        flags: 64, // ephemeral
      });
      return;
    }

    // Create a pending game row (or reuse an existing pending one between same coaches)
    const game = await prisma.game.create({
      data: {
        homeCoachId: homeCoach.id,
        awayCoachId: awayCoach.id,
        homePts,
        awayPts,
        status: 'pending', // you have 'confirmed' elsewhere
      },
    });

    const confirmId = `postscore_confirm_${game.id}`;
    const cancelId = `postscore_cancel_${game.id}`;

    const embed = new EmbedBuilder()
      .setTitle('📝 Score Submission (Pending Confirmation)')
      .setDescription(
        `**${homeCoach.team ?? homeCoach.handle}** ${homePts} — ${awayPts} **${
          awayCoach.team ?? awayCoach.handle
        }**\n\n` +
          `Submitted by: <@${reporterId}> • Opponent: <@${oppUser.id}>\n` +
          `Game ID: \`${game.id}\``,
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

    // Reply immediately and fetch the message for a collector
    const msg = await interaction.reply({
      embeds: [embed],
      components: [row],
      fetchReply: true,
    });

    // Collector: only allow the two coaches to press; 60s timeout
    const filter = (i: ButtonInteraction) =>
      (i.customId === confirmId || i.customId === cancelId) &&
      (i.user.id === reporterId || i.user.id === oppUser.id);

    const collector = (msg as any).createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter,
      time: 60_000,
    });

    collector.on('collect', async (btn: ButtonInteraction) => {
      try {
        // ACKNOWLEDGE FIRST to avoid "This interaction failed"
        await btn.deferUpdate();

        if (btn.customId === cancelId) {
          await prisma.game.update({
            where: { id: game.id },
            data: { status: 'cancelled' as any },
          });
          const cancelled = EmbedBuilder.from(embed)
            .setTitle('❌ Score Submission Cancelled')
            .setColor(0xe74c3c);
          await (msg as any).edit({ embeds: [cancelled], components: [] });
          collector.stop('cancelled');
          return;
        }

        // Confirm path
        await prisma.game.update({
          where: { id: game.id },
          data: { status: 'confirmed' as any },
        });

        // Optional: award coins to winner (comment out if not desired)
        let winnerId = homeCoach.id;
        let loserId = awayCoach.id;
        if (awayPts > homePts) {
          winnerId = awayCoach.id;
          loserId = homeCoach.id;
        }
        if (homePts !== awayPts) {
          await prisma.wallet.upsert({
            where: { coachId: winnerId },
            create: { coachId: winnerId, balance: 500 },
            update: { balance: { increment: 500 } }, // tweak value
          });
          await prisma.wallet.upsert({
            where: { coachId: loserId },
            create: { coachId: loserId, balance: 0 },
            update: {}, // no change for loss
          });
        }

        const confirmed = EmbedBuilder.from(embed)
          .setTitle('✅ Score Confirmed')
          .setColor(0x2ecc71);
        await (msg as any).edit({ embeds: [confirmed], components: [] });
        collector.stop('confirmed');
      } catch (err) {
        console.error('[postscore] button error:', err);
        await (msg as any).edit({
          content: '⚠️ Something went wrong finalizing this score. Try again.',
          components: [],
        });
        collector.stop('error');
      }
    });

    collector.on('end', async (_collected, reason) => {
      if (reason === 'time') {
        const expired = EmbedBuilder.from(embed)
          .setTitle('⌛ Confirmation Timed Out')
          .setColor(0xf1c40f);
        await (msg as any).edit({ embeds: [expired], components: [] });
      }
    });
  },
} as const;
