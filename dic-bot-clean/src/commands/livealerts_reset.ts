import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

function isAdmin(i: ChatInputCommandInteraction) {
  return Boolean(i.memberPermissions?.has(PermissionFlagsBits.Administrator));
}

export const command = {
  data: new SlashCommandBuilder()
    .setName('livealerts_reset')
    .setDescription('Clear isLive/lastItemId for a subscription (admin)')
    .addStringOption(o =>
      o.setName('platform').setDescription('youtube or twitch').setRequired(true)
        .addChoices({ name: 'youtube', value: 'youtube' }, { name: 'twitch', value: 'twitch' }))
    .addStringOption(o =>
      o.setName('id').setDescription('YouTube UC Channel ID or Twitch login').setRequired(true)),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!isAdmin(interaction)) {
      await interaction.reply({ content: '❌ Admin only.', flags: MessageFlags.Ephemeral }); return;
    }
    const platform = interaction.options.getString('platform', true) as 'youtube' | 'twitch';
    const key = interaction.options.getString('id', true).trim();

    const row = await prisma.streamSub.findUnique({
      where: { platform_channelKey: { platform, channelKey: key } },
    });
    if (!row) {
      await interaction.reply({ content: '❌ No subscription found.', flags: MessageFlags.Ephemeral });
      return;
    }
    await prisma.streamSub.update({
      where: { platform_channelKey: { platform, channelKey: key } },
      data: { isLive: false, lastItemId: null },
    });
    await interaction.reply({
      content: `✅ Reset done for **${platform}** • **${key}**. Now run /livealerts_tick to notify if live.`,
      flags: MessageFlags.Ephemeral,
    });
  },
} as const;
