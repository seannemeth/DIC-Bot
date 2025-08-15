// src/commands/livealerts.ts
import {
  SlashCommandBuilder, type ChatInputCommandInteraction, PermissionFlagsBits,
} from 'discord.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function isAdmin(i: ChatInputCommandInteraction) {
  return Boolean(i.memberPermissions?.has(PermissionFlagsBits.Administrator));
}

async function resolveYouTubeChannelId(input: string, apiKey?: string): Promise<{ id?: string; title?: string }> {
  const key = apiKey || process.env.YOUTUBE_API_KEY;
  if (!key) return {};
  // Accept full URL or @handle or raw id
  const trimmed = input.trim();
  // If it already looks like a channelId
  if (/^UC[0-9A-Za-z_-]{22}$/.test(trimmed)) return { id: trimmed };

  // Extract from URL if possible
  try {
    if (trimmed.startsWith('http')) {
      const u = new URL(trimmed);
      // /channel/UCxxxx
      const parts = u.pathname.split('/').filter(Boolean);
      const chIdx = parts.indexOf('channel');
      if (chIdx >= 0 && parts[chIdx + 1] && /^UC/.test(parts[chIdx + 1])) {
        return { id: parts[chIdx + 1] };
      }
      // handle -> need search: type=channel, q=@handle
    }
  } catch {}

  // Use search to resolve handle or name
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'channel');
  url.searchParams.set('maxResults', '1');
  url.searchParams.set('q', trimmed);
  url.searchParams.set('key', key);

  const res = await fetch(url.toString());
  if (!res.ok) return {};
  const json = await res.json();
  const item = json?.items?.[0];
  const id = item?.id?.channelId as string | undefined;
  const title = item?.snippet?.channelTitle as string | undefined;
  return { id, title };
}

async function resolveTwitchLogin(input: string): Promise<{ login?: string; display?: string }> {
  const login = input.replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '').trim().toLowerCase();
  if (!login) return {};
  const clientId = process.env.TWITCH_CLIENT_ID!;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET!;
  // app token
  const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  });
  const tokenJson = await tokenRes.json();
  if (!tokenRes.ok) return { login };
  const access = tokenJson.access_token as string;

  const u = new URL('https://api.twitch.tv/helix/users');
  u.searchParams.set('login', login);
  const res = await fetch(u.toString(), {
    headers: { 'Client-Id': clientId, 'Authorization': `Bearer ${access}` },
  });
  const json = await res.json();
  const user = json?.data?.[0];
  return user ? { login: user.login, display: user.display_name } : { login };
}

export const command = {
  data: new SlashCommandBuilder()
    .setName('livealerts')
    .setDescription('Manage live stream notifications')
    // /livealerts add platform:<youtube|twitch> id:<id/url/handle> [channel:#channel]
    .addSubcommand(sc => sc.setName('add').setDescription('Subscribe your stream')
      .addStringOption(o => o.setName('platform').setDescription('youtube or twitch').setRequired(true)
        .addChoices({ name: 'youtube', value: 'youtube' }, { name: 'twitch', value: 'twitch' }))
      .addStringOption(o => o.setName('id').setDescription('YouTube channel URL/ID/handle or Twitch URL/login').setRequired(true))
      .addChannelOption(o => o.setName('channel').setDescription('Discord channel for your alerts')))
    // /livealerts remove platform:<...> id:<...>
    .addSubcommand(sc => sc.setName('remove').setDescription('Unsubscribe your stream')
      .addStringOption(o => o.setName('platform').setDescription('youtube or twitch').setRequired(true)
        .addChoices({ name: 'youtube', value: 'youtube' }, { name: 'twitch', value: 'twitch' }))
      .addStringOption(o => o.setName('id').setDescription('YouTube channel URL/ID/handle or Twitch URL/login').setRequired(true)))
    // /livealerts list
    .addSubcommand(sc => sc.setName('list').setDescription('List your subscriptions'))
    // /livealerts set-default-channel #channel   (admin)
    .addSubcommand(sc => sc.setName('set-default-channel').setDescription('Set server default alerts channel (admin)')
      .addChannelOption(o => o.setName('channel').setDescription('Channel to post alerts when user didn’t set one').setRequired(true))),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });
    const sub = interaction.options.getSubcommand();

    if (sub === 'set-default-channel') {
      if (!isAdmin(interaction)) {
        await interaction.editReply('❌ Admin only.');
        return;
      }
      const ch = interaction.options.getChannel('channel', true);
      process.env.LIVE_ALERT_CHANNEL_ID = ch.id; // simple in-memory set; persist in DB/config if you prefer
      await interaction.editReply(`✅ Default alerts channel set to <#${ch.id}>`);
      return;
    }

    if (sub === 'add') {
      const platform = interaction.options.getString('platform', true) as 'youtube' | 'twitch';
      const rawId = interaction.options.getString('id', true);
      const channel = interaction.options.getChannel('channel') as any | null;
      const discordChannelId = channel?.id ?? null;

      let channelKey = '';
      let displayName: string | undefined;

      if (platform === 'youtube') {
        const { id, title } = await resolveYouTubeChannelId(rawId);
        if (!id) { await interaction.editReply('❌ Could not resolve that YouTube channel. Provide a channel URL, @handle, or channel ID.'); return; }
        channelKey = id;
        displayName = title;
      } else {
        const { login, display } = await resolveTwitchLogin(rawId);
        if (!login) { await interaction.editReply('❌ Could not resolve that Twitch user. Provide a channel URL or username.'); return; }
        channelKey = login;
        displayName = display;
      }

      const subRow = await prisma.streamSub.upsert({
        where: { platform_channelKey: { platform, channelKey } },
        update: {
          ownerDiscordId: interaction.user.id,
          discordChannelId,
          displayName: displayName ?? undefined,
        },
        create: {
          platform,
          channelKey,
          ownerDiscordId: interaction.user.id,
          discordChannelId,
          displayName: displayName ?? undefined,
        },
      });

      await interaction.editReply(`✅ Subscribed **${displayName ?? channelKey}** on **${platform}**.\nAlerts will post in: ${discordChannelId ? `<#${discordChannelId}>` : `<#${process.env.LIVE_ALERT_CHANNEL_ID}> (default)`}`);
      return;
    }

    if (sub === 'remove') {
      const platform = interaction.options.getString('platform', true) as 'youtube' | 'twitch';
      const rawId = interaction.options.getString('id', true);
      let key = rawId.trim();

      if (platform === 'youtube') {
        const { id } = await resolveYouTubeChannelId(rawId);
        if (id) key = id;
      } else {
        const { login } = await resolveTwitchLogin(rawId);
        if (login) key = login;
      }

      const row = await prisma.streamSub.findUnique({
        where: { platform_channelKey: { platform, channelKey: key } },
      });
      if (!row) { await interaction.editReply('❌ No subscription found.'); return; }
      if (row.ownerDiscordId !== interaction.user.id && !isAdmin(interaction)) {
        await interaction.editReply('❌ You can only remove your own subscriptions (or be an admin).');
        return;
      }
      await prisma.streamSub.delete({ where: { platform_channelKey: { platform, channelKey: key } } });
      await interaction.editReply(`✅ Unsubscribed **${key}** from **${platform}** alerts.`);
      return;
    }

    if (sub === 'list') {
      const mine = await prisma.streamSub.findMany({
        where: { ownerDiscordId: interaction.user.id },
        orderBy: [{ platform: 'asc' }, { channelKey: 'asc' }],
      });
      if (!mine.length) { await interaction.editReply('You have no live alert subscriptions yet. Try `/livealerts add`.'); return; }
      const lines = mine.map(m =>
        `• **${m.platform}** — ${m.displayName ?? m.channelKey} ${m.discordChannelId ? `(→ <#${m.discordChannelId}>)` : '(default channel)'}`
      );
      await interaction.editReply(lines.join('\n'));
      return;
    }

    await interaction.editReply('Unknown subcommand.');
  },
} as const;
