import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
} from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { tickYouTube, tickTwitch } from '../ingest/attachLiveNotifier';

const prisma = new PrismaClient();

function isAdmin(i: ChatInputCommandInteraction) {
  return Boolean(i.memberPermissions?.has(PermissionFlagsBits.Administrator));
}

export const command = {
  data: new SlashCommandBuilder()
    .setName('livealerts_notify')
    .setDescription('Force-post an alert if the channel is live (admin)')
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

    // Reuse your debug probe logic inline (or import if you exported)
    async function probeYT(id: string) {
      const k = process.env.YOUTUBE_API_KEY;
      if (!k) return { live: false as const };
      const u = new URL('https://www.googleapis.com/youtube/v3/search');
      u.searchParams.set('part', 'snippet');
      u.searchParams.set('channelId', id);
      u.searchParams.set('eventType', 'live');
      u.searchParams.set('type', 'video');
      u.searchParams.set('maxResults', '1');
      u.searchParams.set('key', k);
      const r = await fetch(u.toString()); const j = r.ok ? await r.json() : null;
      const vid = j?.items?.[0]?.id?.videoId ?? null;
      const title = j?.items?.[0]?.snippet?.title as string | undefined;
      if (vid) return { live: true as const, id: vid, title };
      // fallback
      const u2 = new URL('https://www.googleapis.com/youtube/v3/search');
      u2.searchParams.set('part', 'snippet');
      u2.searchParams.set('channelId', id);
      u2.searchParams.set('type', 'video');
      u2.searchParams.set('order', 'date');
      u2.searchParams.set('maxResults', '1');
      u2.searchParams.set('key', k);
      const r2 = await fetch(u2.toString()); const j2 = r2.ok ? await r2.json() : null;
      const liveState = j2?.items?.[0]?.snippet?.liveBroadcastContent;
      if (liveState === 'live') {
        return { live: true as const, id: j2.items[0].id.videoId as string, title: j2.items[0].snippet.title as string };
      }
      return { live: false as const };
    }

    async function probeTW(login: string) {
      const id = process.env.TWITCH_CLIENT_ID, sec = process.env.TWITCH_CLIENT_SECRET;
      if (!id || !sec) return { live: false as const };
      const tokRes = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        body: new URLSearchParams({ client_id: id, client_secret: sec, grant_type: 'client_credentials' }),
      });
      const tok = tokRes.ok ? await tokRes.json() : null;
      if (!tok?.access_token) return { live: false as const };
      const uRes = await fetch('https://api.twitch.tv/helix/users?' + new URLSearchParams([['login', login.toLowerCase()]]), {
        headers: { 'Client-Id': id, Authorization: `Bearer ${tok.access_token}` },
      });
      const u = uRes.ok ? await uRes.json() : null;
      const user = u?.data?.[0]; if (!user) return { live: false as const };
      const sRes = await fetch('https://api.twitch.tv/helix/streams?' + new URLSearchParams([['user_id', String(user.id)]]), {
        headers: { 'Client-Id': id, Authorization: `Bearer ${tok.access_token}` },
      });
      const s = sRes.ok ? await sRes.json() : null;
      const live = s?.data?.[0]; if (!live) return { live: false as const };
      return { live: true as const, id: String(live.id), title: live.title as string, url: `https://www.twitch.tv/${user.login}`, display: user.display_name as string };
    }

    const sub = await prisma.streamSub.findUnique({
      where: { platform_channelKey: { platform, channelKey: key } },
    });
    if (!sub) {
      await interaction.reply({ content: '❌ No subscription found for that platform/id.', flags: MessageFlags.Ephemeral });
      return;
    }

    // resolve target channel
    const defaultRow = sub.guildId ? await prisma.liveAlertDefault.findUnique({ where: { guildId: sub.guildId } }).catch(() => null) : null;
    const channelId = sub.discordChannelId || defaultRow?.channelId || process.env.LIVE_ALERT_CHANNEL_ID;
    if (!channelId) {
      await interaction.reply({ content: '❌ No channel to post to (set default or pass channel on /livealerts add).', flags: MessageFlags.Ephemeral });
      return;
    }

    // probe live status
    let live = { live: false as const } as any;
    if (platform === 'youtube') live = await probeYT(key);
    else live = await probeTW(key);

    if (!live.live) {
      await interaction.reply({ content: 'ℹ️ API says this channel is not live right now.', flags: MessageFlags.Ephemeral });
      return;
    }

    const ch = await interaction.client.channels.fetch(channelId).catch(() => null as any);
    if (!ch || !('isTextBased' in ch) || !ch.isTextBased()) {
      await interaction.reply({ content: `❌ Can’t post to <#${channelId}>.`, flags: MessageFlags.Ephemeral });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`${sub.displayName ?? sub.channelKey} is LIVE`)
      .setDescription(live.title ? `**${live.title}**` : 'Streaming now')
      .setURL(platform === 'youtube' ? `https://www.youtube.com/watch?v=${live.id}` : live.url)
      .setColor(platform === 'youtube' ? 0xff0000 : 0x9146ff)
      .setTimestamp(new Date());

    await (ch as any).send({ embeds: [embed] });
    await interaction.reply({ content: `✅ Posted an alert to <#${channelId}>.`, flags: MessageFlags.Ephemeral });
  },
} as const;
