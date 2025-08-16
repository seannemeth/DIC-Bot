import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function safeParse(t: string) {
  try { return JSON.parse(t); } catch { return t; }
}

async function probeYouTube(channelId: string) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    return { ok: false as const, error: 'YOUTUBE_API_KEY not set' };
  }

  const result: any = { ok: true, strict: null, fallback: null };

  // A) strict live
  try {
    const u = new URL('https://www.googleapis.com/youtube/v3/search');
    u.searchParams.set('part', 'snippet');
    u.searchParams.set('channelId', channelId);
    u.searchParams.set('eventType', 'live');
    u.searchParams.set('type', 'video');
    u.searchParams.set('maxResults', '1');
    u.searchParams.set('key', key);

    const r = await fetch(u.toString());
    const body = await r.text();
    result.strict = { status: r.status, body: safeParse(body) };
  } catch (e: any) {
    result.strict = { error: String(e?.message || e) };
  }

  // B) fallback latest
  try {
    const u2 = new URL('https://www.googleapis.com/youtube/v3/search');
    u2.searchParams.set('part', 'snippet');
    u2.searchParams.set('channelId', channelId);
    u2.searchParams.set('type', 'video');
    u2.searchParams.set('order', 'date');
    u2.searchParams.set('maxResults', '1');
    u2.searchParams.set('key', key);

    const r2 = await fetch(u2.toString());
    const body2 = await r2.text();
    result.fallback = { status: r2.status, body: safeParse(body2) };
  } catch (e: any) {
    result.fallback = { error: String(e?.message || e) };
  }

  // derive quick reason
  const fallbackLiveState = result.fallback?.body?.items?.[0]?.snippet?.liveBroadcastContent;
  const strictId = result.strict?.body?.items?.[0]?.id?.videoId ?? null;
  const fallbackId =
    fallbackLiveState === 'live' ? result.fallback?.body?.items?.[0]?.id?.videoId ?? null : null;

  const liveId = strictId || fallbackId;
  const title =
    result.strict?.body?.items?.[0]?.snippet?.title ??
    result.fallback?.body?.items?.[0]?.snippet?.title;

  return {
    ok: true as const,
    live: Boolean(liveId),
    liveId: liveId as string | null,
    liveState: fallbackLiveState as string | undefined,
    title: title as string | undefined,
    raw: result,
  };
}

async function probeTwitch(login: string) {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return { ok: false as const, error: 'TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET not set' };
  }

  const result: any = { ok: true, token: null, users: null, streams: null };

  // token
  try {
    const tr = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      }),
    });
    const body = await tr.text();
    result.token = { status: tr.status, body: safeParse(body) };
    if (!tr.ok) return { ok: false as const, error: `token_error ${tr.status}`, raw: result };
  } catch (e: any) {
    return { ok: false as const, error: `token_fetch ${String(e?.message || e)}` };
  }

  const access = result.token.body?.access_token as string | undefined;
  if (!access) return { ok: false as const, error: 'no_access_token', raw: result };

  // users
  try {
    const ur = await fetch(
      'https://api.twitch.tv/helix/users?' + new URLSearchParams([['login', login.toLowerCase()]]),
      { headers: { 'Client-Id': clientId, Authorization: `Bearer ${access}` } }
    );
    const body = await ur.text();
    result.users = { status: ur.status, body: safeParse(body) };
  } catch (e: any) {
    result.users = { error: String(e?.message || e) };
  }

  const user = result.users?.body?.data?.[0];
  if (!user) {
    return { ok: true as const, live: false, reason: 'no_such_user', raw: result };
  }

  // streams
  try {
    const sr = await fetch(
      'https://api.twitch.tv/helix/streams?' + new URLSearchParams([['user_id', String(user.id)]]),
      { headers: { 'Client-Id': clientId, Authorization: `Bearer ${access}` } }
    );
    const body = await sr.text();
    result.streams = { status: sr.status, body: safeParse(body) };
  } catch (e: any) {
    result.streams = { error: String(e?.message || e) };
  }

  const live = result.streams?.body?.data?.[0] ?? null;

  return {
    ok: true as const,
    live: Boolean(live),
    liveId: live ? String(live.id) : null,
    title: live?.title as string | undefined,
    url: live ? `https://www.twitch.tv/${user.login}` : null,
    raw: result,
  };
}

export const command = {
  data: new SlashCommandBuilder()
    .setName('livealerts_diag')
    .setDescription('Diagnose why a stream alert is not firing')
    .addStringOption(o =>
      o.setName('platform')
        .setDescription('youtube or twitch')
        .setRequired(true)
        .addChoices({ name: 'youtube', value: 'youtube' }, { name: 'twitch', value: 'twitch' }))
    .addStringOption(o =>
      o.setName('id')
        .setDescription('YouTube UC channel ID (starts with UC...) or Twitch login')
        .setRequired(true)),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const platform = interaction.options.getString('platform', true) as 'youtube' | 'twitch';
    const key = interaction.options.getString('id', true).trim();

    // 1) DB row
    const sub = await prisma.streamSub.findUnique({
      where: { platform_channelKey: { platform, channelKey: key } },
    });

    // Try relaxed lookup if not found (insensitive for Twitch)
    let subInfo = sub;
    if (!sub && platform === 'twitch') {
      subInfo = await prisma.streamSub.findFirst({
        where: { platform, channelKey: { equals: key, mode: 'insensitive' } as any },
      });
    }

    // 2) Resolve target channel & verify we can post
    let postTarget = subInfo?.discordChannelId ?? null as string | null;
    if (!postTarget && subInfo?.guildId) {
      try {
        const row = await prisma.liveAlertDefault.findUnique({ where: { guildId: subInfo.guildId } });
        if (row?.channelId) postTarget = row.channelId;
      } catch {}
    }
    if (!postTarget) postTarget = process.env.LIVE_ALERT_CHANNEL_ID ?? null;

    let canPost = false;
    if (postTarget) {
      const ch = await interaction.client.channels.fetch(postTarget).catch(() => null as any);
      canPost = Boolean(ch && 'isTextBased' in ch && ch.isTextBased());
    }

    // 3) Probe API
    const api = platform === 'youtube'
      ? await probeYouTube(key)
      : await probeTwitch(key);

    // 4) Build diagnosis
    const lines: string[] = [];
    lines.push(`**Platform**: ${platform}`);
    lines.push(`**Key**: \`${key}\``);
    lines.push('');

    if (subInfo) {
      lines.push(`**DB subscription**: found`);
      lines.push(`• displayName: ${subInfo.displayName ?? '(null)'}`);
      lines.push(`• isLive: ${subInfo.isLive ? 'true' : 'false'}`);
      lines.push(`• lastItemId: ${subInfo.lastItemId ?? '(null)'}`);
      lines.push(`• guildId: ${subInfo.guildId ?? '(null)'}`);
      lines.push(`• discordChannelId: ${subInfo.discordChannelId ?? '(null)'}`);
    } else {
      lines.push(`**DB subscription**: **NOT FOUND** (use \`/livealerts add\`)`);
    }

    lines.push('');
    lines.push(`**Post target**: ${postTarget ? `<#${postTarget}>` : '(none)'}`);
    lines.push(`**Can post?** ${canPost ? 'yes' : 'no'}`);
    lines.push('');

    if (!api.ok) {
      lines.push(`**API**: error → ${api.error}`);
    } else {
      lines.push(`**API live?** ${api.live ? 'YES' : 'no'}`);

      if (platform === 'youtube') {
        const liveState: string | undefined = (api as any).liveState;
        const liveId: string | null = (api as any).liveId ?? null;
        lines.push(`• liveId: ${liveId ?? '(null)'}`);
        lines.push(`• liveBroadcastContent: ${liveState ?? '(unknown)'}`);
        if (!api.live) {
          lines.push(`👉 If you *are* live: Ensure the stream is **Public** (Unlisted/Private/Members won’t appear). Also confirm **YouTube Data API v3** is enabled for your API key project.`);
        }
      } else {
        const liveId: string | null = (api as any).liveId ?? null;
        const title: string | undefined = (api as any).title;
        lines.push(`• liveId: ${liveId ?? '(null)'}`);
        if (title) lines.push(`• title: ${title}`);
        if (!api.live) {
          lines.push(`👉 If you *are* live: Verify **Twitch login** is correct (not display name), and that the app token is valid (client id/secret correct).`);
        }
      }
    }

    lines.push('');
    lines.push(`**Next steps**`);
    if ((api as any).ok && (api as any).live) {
      lines.push(`• Run \`/livealerts_reset platform:${platform} id:${key}\` then \`/livealerts_tick platform:${platform}\` to clear duplicate-suppression and post now.`);
    } else {
      lines.push(`• Fix the visibility/ID/keys as above, then \`/livealerts_tick platform:${platform}\`.`);
    }

    const emb = new EmbedBuilder()
      .setTitle('Live Alerts Diagnosis')
      .setDescription(lines.join('\n'))
      .setColor((api as any).ok && (api as any).live ? 0x2ecc71 : 0xe67e22)
      .setTimestamp(new Date());

    // attach trimmed raw JSON (first 4KB)
    const raw: any = (api as any).raw ?? {};
    const rawTxt = '```json\n' + JSON.stringify(raw, null, 2).slice(0, 4000) + '\n```';

    await interaction.editReply({ embeds: [emb], content: rawTxt });
  },
} as const;
