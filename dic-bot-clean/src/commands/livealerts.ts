// src/commands/livealerts.ts
import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

function isAdmin(i: ChatInputCommandInteraction) {
  return i.memberPermissions?.has('Administrator');
}

export const command = {
  data: new SlashCommandBuilder()
    .setName('livealerts')
    .setDescription('Manage live stream alerts')
    .addSubcommand(sc =>
      sc.setName('add')
        .setDescription('Subscribe to a YouTube or Twitch channel')
        .addStringOption(o =>
          o.setName('platform').setDescription('youtube or twitch').setRequired(true)
            .addChoices({ name: 'youtube', value: 'youtube' }, { name: 'twitch', value: 'twitch' }))
        .addStringOption(o =>
          o.setName('id').setDescription('Channel ID (YT UC…) or twitch login').setRequired(true))
        .addStringOption(o =>
          o.setName('display').setDescription('Optional display name')))
    .addSubcommand(sc =>
      sc.setName('remove')
        .setDescription('Remove a subscription')
        .addStringOption(o =>
          o.setName('platform').setDescription('youtube or twitch').setRequired(true)
            .addChoices({ name: 'youtube', value: 'youtube' }, { name: 'twitch', value: 'twitch' }))
        .addStringOption(o =>
          o.setName('id').setDescription('Channel ID (YT UC…) or twitch login').setRequired(true)))
    .addSubcommand(sc =>
      sc.setName('list')
        .setDescription('List current subscriptions'))
    .addSubcommand(sc =>
      sc.setName('debug')
        .setDescription('Show stored state for a subscription (admin)')
        .addStringOption(o =>
          o.setName('platform').setDescription('youtube or twitch').setRequired(true)
            .addChoices({ name: 'youtube', value: 'youtube' }, { name: 'twitch', value: 'twitch' }))
        .addStringOption(o =>
          o.setName('id').setDescription('Channel ID (YT UC…) or twitch login').setRequired(true)))
    .addSubcommand(sc =>
      sc.setName('reset')
        .setDescription('Reset state for a subscription (admin)')
        .addStringOption(o =>
          o.setName('platform').setDescription('youtube or twitch').setRequired(true)
            .addChoices({ name: 'youtube', value: 'youtube' }, { name: 'twitch', value: 'twitch' }))
        .addStringOption(o =>
          o.setName('id').setDescription('Channel ID (YT UC…) or twitch login').setRequired(true)))
  ,

  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand(true);

    if (sub === 'add') {
      const platform = interaction.options.getString('platform', true) as 'youtube' | 'twitch';
      const key = interaction.options.getString('id', true).trim();
      const display = interaction.options.getString('display') ?? null;
      await prisma.streamSub.upsert({
        where: { platform_channelKey: { platform, channelKey: key } },
        update: { displayName: display ?? undefined },
        create: { platform, channelKey: key, displayName: display, isLive: false },
      });
      await interaction.reply(`✅ Added ${platform}:${key}`);
      return;
    }

    if (sub === 'remove') {
      const platform = interaction.options.getString('platform', true) as 'youtube' | 'twitch';
      const key = interaction.options.getString('id', true).trim();
      await prisma.streamSub.delete({
        where: { platform_channelKey: { platform, channelKey: key } },
      }).catch(() => null);
      await interaction.reply(`🗑️ Removed ${platform}:${key}`);
      return;
    }

    if (sub === 'list') {
      const rows = await prisma.streamSub.findMany({ orderBy: { updatedAt: 'desc' } });
      if (!rows.length) {
        await interaction.reply('No subscriptions.');
      } else {
        const text = rows.map(r =>
          `• [${r.platform}] ${r.displayName || r.channelKey} (isLive=${r.isLive}, lastItemId=${r.lastItemId ?? 'null'})`
        ).join('\n');
        await interaction.reply('Current subs:\n' + text);
      }
      return;
    }

    if (sub === 'debug') {
      if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Admin only', ephemeral: true });
      const platform = interaction.options.getString('platform', true) as 'youtube' | 'twitch';
      const key = interaction.options.getString('id', true).trim();
      const row = await prisma.streamSub.findUnique({
        where: { platform_channelKey: { platform, channelKey: key } },
      });
      if (!row) return interaction.reply('Not found.');
      const txt = [
        `platform: ${row.platform}`,
        `channelKey: ${row.channelKey}`,
        `displayName: ${row.displayName ?? '(none)'}`,
        `isLive: ${row.isLive}`,
        `lastItemId: ${row.lastItemId ?? '(null)'}`,
        `updatedAt: ${row.updatedAt.toISOString()}`,
      ].join('\n');
      await interaction.reply('```' + txt + '```');
      return;
    }

    if (sub === 'reset') {
      if (!isAdmin(interaction)) return interaction.reply({ content: '❌ Admin only', ephemeral: true });
      const platform = interaction.options.getString('platform', true) as 'youtube' | 'twitch';
      const key = interaction.options.getString('id', true).trim();
      await prisma.streamSub.update({
        where: { platform_channelKey: { platform, channelKey: key } },
        data: { isLive: false, lastItemId: null },
      }).catch(() => null);
      await interaction.reply(`🔄 Reset ${platform}:${key}`);
      return;
    }
  },
};
