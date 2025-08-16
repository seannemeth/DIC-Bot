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

async function resolveTargetChannelId(sub: {
  discordChannelId: string | null;
  guildId: string | null;
}): Promise<string | null> {
  if (sub.discordChannelId) return sub.discordChannelId;
  if (sub.guildId) {
    const row = await prisma.liveAlertDefault.findUnique({
      where: { guildId: sub.guildId },
    }).catch(() => null);
    if (row?.channelId) return row.channelId;
  }
  return process.env.LIVE_ALERT_CHANNEL_ID ?? null;
}

/* -------------------- API probes -------------------- */
async function probeYouTube(channelId: string, apiKey?: string) {
  const key = apiKey || process.env.YOUTUBE_API_KEY;
  if (!key) return { ok: false, reason: 'YOUTUBE_API_KEY missing' as const };

  try {
    const u = new URL('https://www.googleapis.com/youtube/v3/search');
    u.searchParams.set('part', 'snippet');
    u.searchParams.set('channelId', channelId);
    u.searchParams.set('eventType', 'live');
    u.searchParams.set('type', 'video');
    u.searchParams.set('maxResults', '1');
    u.searchParams.set('key', key);

    const res = await fetch(u.toString());
    const txt = await res.text();
    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status}`, body: safeTrim(txt, 800) };
    }
    const json = JSON.parse(txt);
    const item = json?.items?.[0];
    const liveVideoId: string | null = item?.id?.videoId ?? null;
    const title: string | undefined = item?.snippet?.title;
    return { ok: true, isLive: Boolean(liveVideoId), liveId: liveVideoId, title };
  } catch (e: any) {
    return { ok: false, reason: 'fetch_error', body: String(e?.message || e) };
  }
}

async function getTwitchAppToken(clientId?: string, clientSecret?: string) {
  const id = clientId || process.env.TWITCH_CLIENT_ID;
  const sec = clientSecret || process.env.TWITCH_CLIENT_SECRET;
  if (!id || !sec) return { ok: false, reason: 'TWITCH_CLIENT_ID/_SECRET missing' as const };

  try {
    const res = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: id,
        client_secret: sec,
        grant_type: 'client_credentials',
      }),
    });
    const txt = await res.text();
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}`, body: safeTrim(txt, 800) };
    const json = JSON.parse(txt);
    return { ok: true, token: json.access_token as string, clientId: id };
  } catch (e: any) {
    return { ok: false, reason: 'fetch_error', body: String(e?.message || e) };
  }
}

async function probeTwitch(login: string) {
  const tok = await getTwitchAppToken();
  if (!tok.ok) return { ok: false, reason: tok.reason, body: (tok as any).body };

  try {
    // users
    const usersUrl =
      'https://api.twitch.tv/helix/users?' +
      new URLSearchParams([['login', login.toLowerCase()]]);
    const usersRes = await fetch(usersUrl, {
      headers: { 'Client-Id': tok.clientId!, Authorization: `Bearer ${tok.token}` },
    });
    const usersTxt = await usersRes.text();
    if (!usersRes.ok) {
      return { ok: false, reason: `users HTTP ${usersRes.status}`, body: safeTrim(usersTxt, 800) };
    }
    const usersJson = JSON.parse(usersTxt);
    const user = usersJson?.data?.[0];
    if (!user) return { ok: false, reason: 'user_not_found' as const };

    // streams
    const streamsUrl =
      'https://api.twitch.tv/helix/streams?' +
      new URLSearchParams([['user_id', String(user.id)]]);
    const streamsRes = await fetch(streamsUrl, {
      headers: { 'Client-Id': tok.clientId!, Authorization: `Bearer ${tok.token}` },
    });
    const streamsTxt = await streamsRes.text();
    if (!streamsRes.ok) {
      return { ok: false, reason: `streams HTTP ${streamsRes.status}`, body: safeTrim(streamsTxt, 800) };
    }
    const streamsJson = JSON.parse(streamsTxt);
    const live = streamsJson?.data?.[0] || null;
    if (!live) return { ok: true, isLive: false, liveId: null, title: undefined, login: user.login, display: user.display_name };

    return {
      ok: true,
      isLive: true,
      liveId: String(live.id),
      title: live.title as string | undefined,
      login: user.login as string,
      display: user.display_name as string,
    };
  } catch (e: any) {
    return { ok: false, reason: 'fetch_error', body: String(e?.message || e) };
  }
}

function safeTrim(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/* -------------------- Command -------------------- */
export const command = {
  data: new SlashCommandBuilder()
    .setName('livealerts_debug')
    .setDescription('Debug live alerts (probe APIs & show state)')
    .addSubcommand(sc =>
      sc
        .setName('probe')
        .setDescription('Probe a single subscription against the API')
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
    )
    .addSubcommand(sc =>
      sc
        .setName('dumpmine')
        .setDescription('List my subscriptions with computed target channel'),
    )
    .addSubcommand(sc =>
      sc
        .setName('dumpall')
        .setDescription('List all subscriptions (admin only)'),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand(true);

    if (sub === 'dumpall') {
      if (!isAdmin(interaction)) {
        await interaction.reply({ content: '❌ Admin only.', flags: MessageFlags.Ephemeral });
        return;
      }
      const rows = await prisma.streamSub.findMany({ orderBy: [{ platform: 'asc' }, { channelKey: 'asc' }] });
      if (!rows.length) {
        await interaction.reply({ content: 'No subscriptions in DB.', flags: MessageFlags.Ephemeral });
        return;
      }
      const out: string[] = [];
      for (const r of rows) {
        const target = await resolveTargetChannelId({ discordChannelId: r.discordChannelId, guildId: r.guildId });
        out.push(
          `• ${r.platform} — ${r.displayName ?? r.channelKey} ` +
          `→ ${target ? `<#${target}>` : '(no channel)'} | isLive=${r.isLive} | last=${r.lastItemId ?? 'null'} | owner=${r.ownerDiscordId} | guild=${r.guildId ?? 'null'}`
        );
      }
      await interaction.reply({ content: out.join('\n').slice(0, 1900), flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'dumpmine') {
      const rows = await prisma.streamSub.findMany({
        where: { ownerDiscordId: interaction.user.id },
        orderBy: [{ platform: 'asc' }, { channelKey: 'asc' }],
      });
      if (!rows.length) {
        await interaction.reply({ content: 'You have no subscriptions. Use `/livealerts add`.', flags: MessageFlags.Ephemeral });
        return;
      }
      const out: string[] = [];
      for (const r of rows) {
        const target = await resolveTargetChannelId({ discordChannelId: r.discordChannelId, guildId: r.guildId });
        out.push(
          `• ${r.platform} — ${r.displayName ?? r.channelKey} ` +
          `→ ${target ? `<#${target}>` : '(no channel)'} | isLive=${r.isLive} | last=${r.lastItemId ?? 'null'}`
        );
      }
      await interaction.reply({ content: out.join('\n'), flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'probe') {
      const platform = interaction.options.getString('platform', true) as 'youtube' | 'twitch';
      const id = interaction.options.getString('id', true).trim();

      // Look up DB row if present
      const dbRow = await prisma.streamSub.findUnique({
        where: { platform_channelKey: { platform, channelKey: id } },
      }).catch(() => null);

      // Compute target channel (if row exists)
      const target = dbRow
        ? await resolveTargetChannelId({ discordChannelId: dbRow.discordChannelId, guildId: dbRow.guildId })
        : (process.env.LIVE_ALERT_CHANNEL_ID ?? null);

      // Probe the live API
      let api: any;
      if (platform === 'youtube') {
        // Expect a UCxxxx Channel ID here
        api = await probeYouTube(id);
      } else {
        // Expect a Twitch login (username) here
        api = await probeTwitch(id);
      }

      const lines: string[] = [];
      lines.push(`platform: ${platform}`);
      lines.push(`channelKey: ${id}`);
      lines.push(`targetChannel: ${target ? `<#${target}>` : '(none)'}`);
      lines.push('');

      if (dbRow) {
        lines.push('[DB]');
        lines.push(`  displayName: ${dbRow.displayName ?? '(none)'}`);
        lines.push(`  isLive: ${dbRow.isLive}`);
        lines.push(`  lastItemId: ${dbRow.lastItemId ?? 'null'}`);
        lines.push(`  ownerDiscordId: ${dbRow.ownerDiscordId}`);
        lines.push(`  guildId: ${dbRow.guildId ?? 'null'}`);
        lines.push('');
      } else {
        lines.push('[DB] no subscription row found for this key');
        lines.push('');
      }

      lines.push('[API]');
      if (!api?.ok) {
        lines.push(`  ok: false`);
        lines.push(`  reason: ${api?.reason ?? 'unknown'}`);
        if (api?.body) lines.push(`  body: ${api.body}`);
      } else {
        lines.push(`  ok: true`);
        lines.push(`  isLive: ${api.isLive ? 'true' : 'false'}`);
        if (platform === 'youtube') {
          lines.push(`  liveId(videoId): ${api.liveId ?? 'null'}`);
          if (api.title) lines.push(`  title: ${api.title}`);
        } else {
          lines.push(`  liveId(streamId): ${api.liveId ?? 'null'}`);
          if (api.login) lines.push(`  login: ${api.login}`);
          if (api.display) lines.push(`  display: ${api.display}`);
          if (api.title) lines.push(`  title: ${api.title}`);
        }
        lines.push('');
        // Would it notify?
        if (dbRow) {
          const wouldNotify =
            api.isLive &&
            String(api.liveId || '') !== String(dbRow.lastItemId || '') /* new session */;
          lines.push(`[Decision] wouldNotify: ${wouldNotify ? 'YES' : 'NO'}`);
          if (!wouldNotify) {
            if (!api.isLive) lines.push('  reason: API says not live');
            else lines.push('  reason: already notified this live session (same liveId)');
          }
        } else {
          const wouldNotify = api.isLive && !!target;
          lines.push(`[Decision] wouldNotify (no DB row): ${wouldNotify ? 'LIKELY' : 'NO'}`);
          if (!api.isLive) lines.push('  reason: API says not live');
          else if (!target) lines.push('  reason: no target channel to post to');
        }
      }

      await interaction.reply({
        content: '```txt\n' + lines.join('\n').slice(0, 1900) + '\n```',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  },
} as const;
