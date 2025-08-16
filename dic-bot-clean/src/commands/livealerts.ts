// src/commands/livealerts.ts
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
    .setName('livealerts')
    .setDescription('Manage live stream alerts')
    // /livealerts add
    .addSubcommand(sc =>
      sc
        .setName('add')
        .setDescription('Subscribe to a YouTube or Twitch channel')
        .addStringOption(o =>
          o
            .setName('platform')
            .setDescription('youtube or twitch')
            .setRequired(true)
            .addChoices(
              { name: 'youtube', value: 'youtube' },
              { name: 'twitch', value: 'twitch' },
            ),
        )
        .addStringOption(o =>
          o
            .setName('id')
            .setDescription('YouTube channel ID (UC…) or Twitch login (username)')
            .setRequired(true),
        )
        .addStringOption(o =>
          o
            .setName('display')
            .setDescription('Optional display name (what to show in alerts)'),
        )
        .addChannelOption(o =>
          o
            .setName('channel')
            .setDescription('Discord channel to post alerts (optional; overrides default)'),
        ),
    )
    // /livealerts remove
    .addSubcommand(sc =>
      sc
        .setName('remove')
        .setDescription('Remove a subscription')
        .addStringOption(o =>
          o
            .setName('platform')
            .setDescription('youtube or twitch')
            .setRequired(true)
            .addChoices(
              { name: 'youtube', value: 'youtube' },
              { name: 'twitch', value: 'twitch' },
            ),
        )
        .addStringOption(o =>
          o
            .setName('id')
            .setDescription('Channel ID (YT UC…) or Twitch login')
            .setRequired(true),
        ),
    )
    // /livealerts list
    .addSubcommand(sc => sc.setName('list').setDescription('List your subscriptions'))
    // /livealerts debug (admin)
    .addSubcommand(sc =>
      sc
        .setName('debug')
        .setDescription('Show stored state for a subscription (admin)')
        .addStringOption(o =>
          o
            .setName('platform')
            .setDescription('youtube or twitch')
            .setRequired(true)
            .addChoices(
              { name: 'youtube', value: 'youtube' },
              { name: 'twitch', value: 'twitch' },
            ),
        )
        .addStringOption(o =>
          o
            .setName('id')
            .setDescription('Channel ID (YT UC…) or Twitch login')
            .setRequired(true),
        ),
    )
    // /livealerts reset (admin)
    .addSubcommand(sc =>
      sc
        .setName('reset')
        .setDescription('Reset state for a subscription (admin)')
        .addStringOption(o =>
          o
            .setName('platform')
            .setDescription('youtube or twitch')
            .setRequired(true)
            .addChoices(
              { name: 'youtube', value: 'youtube' },
              { name: 'twitch', value: 'twitch' },
            ),
        )
        .addStringOption(o =>
          o
            .setName('id')
            .setDescription('Channel ID (YT UC…) or Twitch login')
            .setRequired(true),
        ),
    )
    // /livealerts set-default-channel (admin)
    .addSubcommand(sc =>
      sc
        .setName('set-default-channel')
        .setDescription('Set this server’s default live alert channel (admin)')
        .addChannelOption(o =>
          o
            .setName('channel')
            .setDescription('Channel used when a subscription has no channel set')
            .setRequired(true),
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand(true);

    if (sub === 'set-default-channel') {
      if (!isAdmin(interaction)) {
        await interaction.reply({ content: '❌ Admin only.', flags: MessageFlags.Ephemeral });
        return;
      }
      if (!interaction.guildId) {
        await interaction.reply({ content: 'This command must be used in a server.', flags: MessageFlags.Ephemeral });
        return;
      }
      const ch = interaction.options.getChannel('channel', true);
      await prisma.liveAlertDefault.upsert({
        where: { guildId: interaction.guildId },
        update: { channelId: ch.id },
        create: { guildId: interaction.guildId, channelId: ch.id },
      });
      await interaction.reply({
        content: `✅ Default alert channel set to <#${ch.id}> for this server.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'add') {
      const platform = interaction.options.getString('platform', true) as 'youtube' | 'twitch';
      const key = interaction.options.getString('id', true).trim();
      const display = interaction.options.getString('display') ?? undefined;
      const ch = interaction.options.getChannel('channel');
      const discordChannelId = ch?.id ?? null;

      const ownerDiscordId = interaction.user.id;
      const guildId = interaction.guildId ?? null;

      await prisma.streamSub.upsert({
        where: { platform_channelKey: { platform, channelKey: key } },
        update: {
          ownerDiscordId,
          displayName: display,
          discordChannelId,
          guildId, // ✅ keep where it was created
        },
        create: {
          platform,
          channelKey: key,
          ownerDiscordId,
          displayName: display,
          discordChannelId,
          guildId, // ✅
          isLive: false,
          lastItemId: null,
        },
      });

      await interaction.reply({
        content:
          `✅ Subscribed **${display ?? key}** on **${platform}** ` +
          (discordChannelId
            ? `→ alerts in <#${discordChannelId}>`
            : `→ will use this server’s default (set via /livealerts set-default-channel)`),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'remove') {
      const platform = interaction.options.getString('platform', true) as 'youtube' | 'twitch';
      const key = interaction.options.getString('id', true).trim();

      const row = await prisma.streamSub.findUnique({
        where: { platform_channelKey: { platform, channelKey: key } },
      });
      if (!row) {
        await interaction.reply({ content: '❌ Subscription not found.', flags: MessageFlags.Ephemeral });
        return;
      }
      if (row.ownerDiscordId !== interaction.user.id && !isAdmin(interaction)) {
        await interaction.reply({ content: '❌ You can only remove your own subscriptions (or be an admin).', flags: MessageFlags.Ephemeral });
        return;
      }

      await prisma.streamSub.delete({
        where: { platform_channelKey: { platform, channelKey: key } },
      });

      await interaction.reply({ content: `🗑️ Removed **${platform}:${key}**`, flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'list') {
      const mine = await prisma.streamSub.findMany({
        where: { ownerDiscordId: interaction.user.id },
        orderBy: [{ platform: 'asc' }, { channelKey: 'asc' }],
      });

      if (!mine.length) {
        await interaction.reply({
          content: 'You have no live alert subscriptions yet. Try `/livealerts add`.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Try to show effective target channel for each
      const lines: string[] = [];
      for (const m of mine) {
        let target = m.discordChannelId ? `<#${m.discordChannelId}>` : '(default)';
        if (!m.discordChannelId && m.guildId) {
          const def = await prisma.liveAlertDefault.findUnique({ where: { guildId: m.guildId } });
          if (def?.channelId) target = `<#${def.channelId}> (server default)`;
        }
        lines.push(
          `• **${m.platform}** — ${m.displayName ?? m.channelKey} → ${target} | isLive=${m.isLive} | last=${m.lastItemId ?? 'null'}`
        );
      }

      await interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'debug') {
      if (!isAdmin(interaction)) {
        await interaction.reply({ content: '❌ Admin only.', flags: MessageFlags.Ephemeral });
        return;
      }
      const platform = interaction.options.getString('platform', true) as 'youtube' | 'twitch';
      const key = interaction.options.getString('id', true).trim();

      const row = await prisma.streamSub.findUnique({
        where: { platform_channelKey: { platform, channelKey: key } },
      });
      if (!row) {
        await interaction.reply({ content: 'Not found.', flags: MessageFlags.Ephemeral });
        return;
      }

      const txt = [
        `platform: ${row.platform}`,
        `channelKey: ${row.channelKey}`,
        `displayName: ${row.displayName ?? '(none)'}`,
        `ownerDiscordId: ${row.ownerDiscordId}`,
        `guildId: ${row.guildId ?? '(null)'}`,
        `discordChannelId: ${row.discordChannelId ?? '(default)'}`,
        `isLive: ${row.isLive}`,
        `lastItemId: ${row.lastItemId ?? 'null'}`,
        `updatedAt: ${row.updatedAt.toISOString()}`,
      ].join('\n');

      await interaction.reply({ content: '```' + txt + '```', flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'reset') {
      if (!isAdmin(interaction)) {
        await interaction.reply({ content: '❌ Admin only.', flags: MessageFlags.Ephemeral });
        return;
      }
      const platform = interaction.options.getString('platform', true) as 'youtube' | 'twitch';
      const key = interaction.options.getString('id', true).trim();

      await prisma.streamSub.update({
        where: { platform_channelKey: { platform, channelKey: key } },
        data: { isLive: false, lastItemId: null },
      }).catch(() => null);

      await interaction.reply({ content: `🔄 Reset **${platform}:${key}**`, flags: MessageFlags.Ephemeral });
      return;
    }
  },
} as const;
