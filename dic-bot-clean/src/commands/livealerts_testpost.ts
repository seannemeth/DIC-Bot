import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
} from 'discord.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function isAdmin(i: ChatInputCommandInteraction) {
  return Boolean(i.memberPermissions?.has(PermissionFlagsBits.Administrator));
}

async function resolveTargetChannelId(sub: {
  discordChannelId: string | null;
  guildId: string | null;
}): Promise<string | null> {
  if (sub.discordChannelId) return sub.discordChannelId;
  if (sub.guildId) {
    try {
      const row = await prisma.liveAlertDefault.findUnique({ where: { guildId: sub.guildId } });
      if (row?.channelId) return row.channelId;
    } catch {}
  }
  return process.env.LIVE_ALERT_CHANNEL_ID ?? null;
}

export const command = {
  data: new SlashCommandBuilder()
    .setName('livealerts_testpost')
    .setDescription('Post a test alert to the resolved channel for a subscription (admin)')
    .addStringOption(o =>
      o
        .setName('platform')
        .setDescription('youtube or twitch')
        .setRequired(true)
        .addChoices({ name: 'youtube', value: 'youtube' }, { name: 'twitch', value: 'twitch' }),
    )
    .addStringOption(o =>
      o
        .setName('id')
        .setDescription('YouTube UC Channel ID or Twitch login (username)')
        .setRequired(true),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!isAdmin(interaction)) {
      await interaction.reply({ content: '❌ Admin only.', flags: MessageFlags.Ephemeral });
      return;
    }

    const platform = interaction.options.getString('platform', true) as 'youtube' | 'twitch';
    const key = interaction.options.getString('id', true).trim();

    const sub = await prisma.streamSub.findUnique({
      where: { platform_channelKey: { platform, channelKey: key } },
    });

    if (!sub) {
      await interaction.reply({
        content: '❌ No subscription found for that platform/id. Use /livealerts add first.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const channelId = await resolveTargetChannelId({
      discordChannelId: sub.discordChannelId,
      guildId: sub.guildId,
    });

    if (!channelId) {
      await interaction.reply({
        content: '❌ No target channel resolved. Set a default with /livealerts set-default-channel or add the sub with a channel option.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const ch = await interaction.client.channels.fetch(channelId).catch(() => null as any);
    if (!ch || !('isTextBased' in ch) || !ch.isTextBased()) {
      await interaction.reply({
        content: `❌ Resolved channel <#${channelId}> is not a text-based channel or I can’t access it.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`${sub.displayName ?? sub.channelKey} (TEST)`)
      .setDescription(`This is a test alert for **${platform}** → posting to this channel.`)
      .setURL(platform === 'youtube'
        ? `https://www.youtube.com/channel/${sub.channelKey}`
        : `https://www.twitch.tv/${sub.channelKey}`)
      .setColor(platform === 'youtube' ? 0xff0000 : 0x9146ff)
      .setTimestamp(new Date());

    await (ch as any).send({ embeds: [embed] }).catch(() => {});
    await interaction.reply({
      content: `✅ Sent a test alert to <#${channelId}>.`,
      flags: MessageFlags.Ephemeral,
    });
  },
} as const;
