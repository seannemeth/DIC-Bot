// src/ingest/attachLiveNotifier.ts
import { Client, EmbedBuilder, TextChannel } from 'discord.js';
import { PrismaClient } from '@prisma/client';

type TwitchToken = { access_token: string; expires_at: number };

const prisma = new PrismaClient();

// ENV
const PERIOD_MS = 60_000;
const DEFAULT_CHANNEL_ID = process.env.LIVE_ALERT_CHANNEL_ID ?? '';
const YT_KEY = process.env.YOUTUBE_API_KEY ?? '';
const TW_CLIENT_ID = process.env.TWITCH_CLIENT_ID ?? '';
const TW_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET ?? '';

// In-memory debounce state
const mem = new Map<string, { isLive: boolean; last?: string }>();
let twitchToken: TwitchToken | null = null;

type SubRow = {
  platform: string;          // 'youtube' | 'twitch'
  channelKey: string;        // YouTube channelId or Twitch login
  discordChannelId: string | null;
  displayName: string | null;
  lastItemId: string | null;
  isLive: boolean;
};

// ---------- helpers ----------
async function getChannel(client: Client, id?: string): Promise<TextChannel | null> {
  const cid = id || DEFAULT_CHANNEL_ID;
  if (!cid) return null;
  const ch = await client.channels.fetch(cid).catch(() => null);
  return ch && ch.isTextBased() ? (ch as TextChannel) : null;
}

async function fetchJson<T>(u: string, init?: RequestInit) {
  const r = await fetch(u, init);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}

// ---------- YouTube ----------
function ytLiveUrl(channelId: string) {
  const u = new URL('https://www.googleapis.com/youtube/v3/search');
  u.searchParams.set('part', 'snippet');
  u.searchParams.set('channelId', channelId);
  u.searchParams.set('eventType', 'live');
  u.searchParams.set('type', 'video');
  u.searchParams.set('maxResults', '1');
  u.searchParams.set('key', YT_KEY);
  return u.toString();
}

async function tickYouTube(client: Client) {
  if (!YT_KEY) return;
  const subs = await prisma.streamSub.findMany({
    where: { platform: 'youtube' },
    select: {
      platform: true, channelKey: true,
      discordChannelId: true, displayName: true,
      lastItemId: true, isLive: true,
    },
  });

  for (const s of subs as SubRow[]) {
    try {
      const data = await fetchJson<any>(ytLiveUrl(s.channelKey));
      const item = data.items?.[0];
      const liveId: string | undefined = item?.id?.videoId;
      const title: string | undefined = item?.snippet?.title;
      const channelTitle: string | undefined = item?.snippet?.channelTitle;

      const key = `yt:${s.channelKey}`;
      const prev = mem.get(key) || { isLive: false };

      if (liveId) {
        const already = prev.isLive && prev.last === liveId;
        if (!already) {
          mem.set(key, { isLive: true, last: liveId });

          await prisma.streamSub.update({
            where: { platform_channelKey: { platform: 'youtube', channelKey: s.channelKey } },
            data: { isLive: true, lastItemId: liveId, displayName: s.displayName ?? channelTitle ?? undefined },
          });

          const ch = await getChannel(client, s.discordChannelId ?? undefined);
          if (ch) {
            const url = `https://www.youtube.com/watch?v=${liveId}`;
            const thumb = item?.snippet?.thumbnails?.high?.url || item?.snippet?.thumbnails?.default?.url;
            const embed = new EmbedBuilder()
              .setTitle(`${channelTitle ?? s.displayName ?? 'Channel'} is LIVE on YouTube`)
              .setDescription(`[${title ?? 'Watch now'}](${url})`)
              .setURL(url)
              .setColor(0xff0000)
              .setThumbnail(thumb ?? null)
              .setTimestamp(new Date());
            await ch.send({ content: `🔴 **YouTube Live**`, embeds: [embed] });
          }
        }
      } else {
        if (prev.isLive) mem.set(key, { isLive: false, last: prev.last });
        await prisma.streamSub.update({
          where: { platform_channelKey: { platform: 'youtube', channelKey: s.channelKey } },
          data: { isLive: false },
        });
      }
    } catch {
      // swallow errors per-channel (quota or network)
    }
  }
}

// ---------- Twitch ----------
async function getTwitchAppToken(): Promise<TwitchToken> {
  if (twitchToken && Date.now() < twitchToken.expires_at - 60_000) return twitchToken;
  const r = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: TW_CLIENT_ID, client_secret: TW_CLIENT_SECRET, grant_type: 'client_credentials',
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j));
  twitchToken = { access_token: j.access_token, expires_at: Date.now() + j.expires_in * 1000 };
  return twitchToken;
}

async function tFetch(path: string, params: Record<string, string | string[]>) {
  const token = await getTwitchAppToken();
  const u = new URL(`https://api.twitch.tv/helix/${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach(x => u.searchParams.append(k, x));
    else u.searchParams.set(k, v);
  });
  const r = await fetch(u.toString(), { headers: { 'Client-Id': TW_CLIENT_ID, 'Authorization': `Bearer ${token.access_token}` } });
  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j));
  return j;
}

export async function tickTwitch(client: Client) {
  if (!TW_CLIENT_ID || !TW_CLIENT_SECRET) return;
  const subs = await prisma.streamSub.findMany({
    where: { platform: 'twitch' },
    select: {
      platform: true, channelKey: true,
      discordChannelId: true, displayName: true,
      lastItemId: true, isLive: true,
    },
  });

  if (!subs.length) return;

  const logins = subs.map(s => s.channelKey);
  const users = (await tFetch('users', { login: logins }))?.data ?? [];
  const idByLogin = new Map<string, string>();
  const displayByLogin = new Map<string, string>();
  for (const u of users) {
    idByLogin.set(String(u.login).toLowerCase(), String(u.id));
    displayByLogin.set(String(u.login).toLowerCase(), String(u.display_name));
  }
  const ids = Array.from(idByLogin.values());
  if (!ids.length) return;

  const streams = (await tFetch('streams', { user_id: ids }))?.data ?? [];
  const liveByUserId = new Map<string, any>();
  for (const s of streams) liveByUserId.set(String(s.user_id), s);

  for (const sub of subs as SubRow[]) {
    const userId = idByLogin.get(sub.channelKey.toLowerCase());
    if (!userId) continue;
    const live = liveByUserId.get(userId);

    const key = `tw:${sub.channelKey}`;
    const prev = mem.get(key) || { isLive: false };

    if (live) {
      const streamId = String(live.id);
      const already = prev.isLive && prev.last === streamId;
      if (!already) {
        mem.set(key, { isLive: true, last: streamId });
        await prisma.streamSub.update({
          where: { platform_channelKey: { platform: 'twitch', channelKey: sub.channelKey } },
          data: { isLive: true, lastItemId: streamId, displayName: sub.displayName ?? displayByLogin.get(sub.channelKey.toLowerCase()) ?? undefined },
        });

        const ch = await getChannel(client, sub.discordChannelId ?? undefined);
        if (ch) {
          const url = `https://twitch.tv/${sub.channelKey}`;
          const thumb = (live.thumbnail_url as string | undefined)?.replace('{width}', '1280').replace('{height}', '720');
          const embed = new EmbedBuilder()
            .setTitle(`${displayByLogin.get(sub.channelKey.toLowerCase()) ?? sub.channelKey} is LIVE on Twitch`)
            .setDescription(`[${live.title || 'Watch now'}](${url})`)
            .setURL(url)
            .setColor(0x9146ff)
            .setImage(thumb ?? null)
            .setTimestamp(new Date());
          await ch.send({ content: `🟣 **Twitch Live**`, embeds: [embed] });
        }
      }
    } else {
      if (prev.isLive) mem.set(key, { isLive: false, last: prev.last });
      await prisma.streamSub.update({
        where: { platform_channelKey: { platform: 'twitch', channelKey: sub.channelKey } },
        data: { isLive: false },
      });
    }
  }
}

// ---------- public entry ----------
export function attachLiveNotifier(client: Client) {
  if (!DEFAULT_CHANNEL_ID) {
    console.warn('[live-notifier] LIVE_ALERT_CHANNEL_ID not set: using per-sub channels only.');
  }
  if (!YT_KEY && (!TW_CLIENT_ID || !TW_CLIENT_SECRET)) {
    console.warn('[live-notifier] No YouTube or Twitch credentials; notifier disabled.');
    return;
  }

  const tick = async () => {
    try { await tickYouTube(client); } catch {}
    try { await tickTwitch(client); } catch {}
  };

  // start now & interval
  tick().catch(() => {});
  setInterval(tick, PERIOD_MS);
}
