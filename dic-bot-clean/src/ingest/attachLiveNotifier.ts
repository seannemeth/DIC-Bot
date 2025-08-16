// src/ingest/attachLiveNotifier.ts
import { Client, EmbedBuilder } from 'discord.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PERIOD_MS = Number(process.env.LIVE_ALERT_PERIOD_MS || 60_000);
const DEBUG_LIVE = process.env.LIVE_ALERT_DEBUG === '1';
const dlog = (...a: unknown[]) => { if (DEBUG_LIVE) console.log('[live]', ...a); };

// Resolve the channel to post in (priority):
// 1) subscription.discordChannelId
// 2) server default from LiveAlertDefault by sub.guildId
// 3) env LIVE_ALERT_CHANNEL_ID (global fallback)
async function resolveTargetChannelId(sub: {
  discordChannelId: string | null;
  guildId: string | null;
}): Promise<string | null> {
  if (sub.discordChannelId) return sub.discordChannelId;

  if (sub.guildId) {
    try {
      const row = await prisma.liveAlertDefault.findUnique({
        where: { guildId: sub.guildId },
      });
      if (row?.channelId) return row.channelId;
    } catch { /* ignore */ }
  }

  return process.env.LIVE_ALERT_CHANNEL_ID ?? null;
}

// Helper to post in the right channel
async function postAlert(client: any, sub: any, embed: any): Promise<boolean> {
  // resolve target channel (sub.discordChannelId -> guild default -> env)
  const channelId = sub.discordChannelId || (sub.guildId
    ? (await prisma.liveAlertDefault.findUnique({ where: { guildId: sub.guildId } }).catch(() => null))?.channelId
    : null) || process.env.LIVE_ALERT_CHANNEL_ID;

  if (!channelId) { console.warn('[live] no target channel for', sub.platform, sub.channelKey); return false; }

  const ch = await client.channels.fetch(channelId).catch((e: any) => {
    console.warn('[live] fetch channel failed', channelId, e?.message || e);
    return null;
  });
  if (!ch || !('isTextBased' in ch) || !ch.isTextBased()) {
    console.warn('[live] channel not text-based or inaccessible', channelId);
    return false;
  }
  try {
    await (ch as any).send({ embeds: [embed] });
    return true;
  } catch (e: any) {
    console.warn('[live] send failed', channelId, e?.message || e);
    return false;
  }
}

/* ------------------------ YouTube ticker ------------------------ */
// Stronger YouTube detection: try (A) strict live search, then (B) fallback by latest item
export async function tickYouTube(client: Client): Promise<void> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return;

  const subs = await prisma.streamSub.findMany({ where: { platform: 'youtube' } });
  dlog('tickYouTube: subs', subs.length);

  for (const sub of subs) {
    const channelId = sub.channelKey; // UCxxxx

    let liveVideoId: string | null = null;
    let title: string | undefined;

    // --- (A) Primary: strict live filter ---
    try {
      const u = new URL('https://www.googleapis.com/youtube/v3/search');
      u.searchParams.set('part', 'snippet');
      u.searchParams.set('channelId', channelId);
      u.searchParams.set('eventType', 'live');
      u.searchParams.set('type', 'video');
      u.searchParams.set('maxResults', '1');
      u.searchParams.set('key', key);

      const res = await fetch(u.toString());
      if (res.ok) {
        const json: any = await res.json();
        const item = json?.items?.[0];
        liveVideoId = item?.id?.videoId ?? null;
        title = item?.snippet?.title;
      } else {
        dlog('yt http error (strict)', res.status, await res.text().catch(() => ''));
      }
    } catch (e) {
      dlog('yt fetch error (strict)', e);
    }

    // --- (B) Fallback: latest video with liveBroadcastContent === "live" ---
    if (!liveVideoId) {
      try {
        const u2 = new URL('https://www.googleapis.com/youtube/v3/search');
        u2.searchParams.set('part', 'snippet');
        u2.searchParams.set('channelId', channelId);
        u2.searchParams.set('type', 'video');
        u2.searchParams.set('order', 'date');
        u2.searchParams.set('maxResults', '1');
        u2.searchParams.set('key', key);

        const res2 = await fetch(u2.toString());
        if (res2.ok) {
          const json2: any = await res2.json();
          const item2 = json2?.items?.[0];
          const liveState = item2?.snippet?.liveBroadcastContent; // "live" | "upcoming" | "none"
          if (liveState === 'live') {
            liveVideoId = item2?.id?.videoId ?? null;
            title = item2?.snippet?.title;
          }
        } else {
          dlog('yt http error (fallback)', res2.status, await res2.text().catch(() => ''));
        }
      } catch (e) {
        dlog('yt fetch error (fallback)', e);
      }
    }

    const isNowLive = Boolean(liveVideoId);

    if (isNowLive) {
      const alreadyNotified = sub.isLive && sub.lastItemId === liveVideoId;
      if (!alreadyNotified) {
        const embed = new EmbedBuilder()
          .setTitle(`${sub.displayName || 'YouTube channel'} is LIVE`)
          .setDescription(title ? `**${title}**` : 'Streaming now')
          .setURL(`https://www.youtube.com/watch?v=${liveVideoId}`)
          .setColor(0xff0000)
          .setTimestamp(new Date());
        const posted = await postAlert(client, sub, embed);
        dlog('yt post', sub.channelKey, 'posted?', posted, 'videoId', liveVideoId);
      }
      await prisma.streamSub.update({
        where: { platform_channelKey: { platform: 'youtube', channelKey: sub.channelKey } },
        data: { isLive: true, lastItemId: liveVideoId || undefined },
      }).catch(() => {});
      continue;
    }

    // not live → reset so next go-live notifies again
    if (sub.isLive || sub.lastItemId) {
      dlog('yt reset', sub.channelKey);
      await prisma.streamSub.update({
        where: { platform_channelKey: { platform: 'youtube', channelKey: sub.channelKey } },
        data: { isLive: false, lastItemId: null },
      }).catch(() => {});
    }
  }
}
/* ------------------------ Twitch ticker ------------------------ */
export async function tickTwitch(client: Client): Promise<void> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return;

  // app token
  let access = '';
  try {
    const res = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      }),
    });
    const json: any = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(json));
    access = json.access_token as string;
  } catch (e) {
    dlog('twitch token error', e);
    return;
  }

  const subs = await prisma.streamSub.findMany({ where: { platform: 'twitch' } });
  dlog('tickTwitch: subs', subs.length);

  // Resolve logins -> ids
  const logins: string[] = subs.map((s: any) => s.channelKey).filter(Boolean);
  if (!logins.length) return;

  const usersRes = await fetch(
    'https://api.twitch.tv/helix/users?' +
      new URLSearchParams(logins.map((l: string) => ['login', l])),
    { headers: { 'Client-Id': clientId, Authorization: `Bearer ${access}` } }
  );
  const usersJson: any = await usersRes.json().catch(() => ({} as any));

  // Build login -> user map
  const byLogin: Record<string, any> = {};
  for (const u of usersJson?.data ?? []) {
    const login = (u.login ?? '').toLowerCase();
    if (login) byLogin[login] = u;
  }

  // Query streams for those users (user_id list)
  const userIds: string[] = Object.values(byLogin).map((u: any) => String(u.id)).filter(Boolean);
  if (userIds.length) {
    const streamsRes = await fetch(
      'https://api.twitch.tv/helix/streams?' +
        new URLSearchParams(userIds.map((id: string) => ['user_id', id])),
      { headers: { 'Client-Id': clientId, Authorization: `Bearer ${access}` } }
    );
    const streamsJson: any = await streamsRes.json().catch(() => ({} as any));

    const liveByUserId: Record<string, any> = {};
    for (const s of streamsJson?.data ?? []) {
      if (s?.user_id) liveByUserId[String(s.user_id)] = s;
    }

    for (const sub of subs) {
      const login = (sub.channelKey ?? '').toLowerCase();
      const user = byLogin[login];
      if (!user) continue;

      const live = liveByUserId[String(user.id)] || null;

      if (live) {
        // Use stream id as unique live session id
        const streamId: string = String(live.id);
        const title: string | undefined = live.title;

        const alreadyNotified = sub.isLive && sub.lastItemId === streamId;

        if (!alreadyNotified) {
          const embed = new EmbedBuilder()
            .setTitle(`${sub.displayName || user.display_name} is LIVE on Twitch`)
            .setDescription(title ? `**${title}**` : 'Streaming now')
            .setURL(`https://www.twitch.tv/${user.login}`)
            .setColor(0x9146ff)
            .setTimestamp(new Date());
          const posted = await postAlert(client, sub, embed);
          dlog('tw post', sub.channelKey, 'posted?', posted, 'streamId', streamId);
        }

        await prisma.streamSub.update({
          where: { platform_channelKey: { platform: 'twitch', channelKey: sub.channelKey } },
          data: { isLive: true, lastItemId: streamId },
        }).catch(() => {});
      } else {
        // not live → reset
        if (sub.isLive || sub.lastItemId) {
          dlog('tw reset', sub.channelKey);
          await prisma.streamSub.update({
            where: { platform_channelKey: { platform: 'twitch', channelKey: sub.channelKey } },
            data: { isLive: false, lastItemId: null },
          }).catch(() => {});
        }
      }
    }
  }
}

/* ------------------------ Attacher ------------------------ */
export function attachLiveNotifier(client: Client): Promise<void> {
  const run = async () => {
    try {
      await Promise.allSettled([tickYouTube(client), tickTwitch(client)]);
    } catch (e) {
      console.error('[live] tick error', e);
    }
  };
  // initial + interval
  run();
  setInterval(run, PERIOD_MS);
  console.log('[live] notifier attached. period=', PERIOD_MS, 'ms');
  return Promise.resolve();
}
