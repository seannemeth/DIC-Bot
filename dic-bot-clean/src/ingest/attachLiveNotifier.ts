// src/ingest/attachLiveNotifier.ts
import { Client, EmbedBuilder } from 'discord.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PERIOD_MS = Number(process.env.LIVE_ALERT_PERIOD_MS || 60_000);
const DEBUG_LIVE = process.env.LIVE_ALERT_DEBUG === '1';
const dlog = (...a: any[]) => DEBUG_LIVE && console.log('[live]', ...a);

// Resolve the channel to post in (priority):
//   1) subscription.discordChannelId
//   2) server default from LiveAlertDefault by sub.guildId
//   3) env LIVE_ALERT_CHANNEL_ID (global fallback)
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

// Helper to post in the right channel
async function postAlert(client: Client, sub: any, embed: EmbedBuilder) {
  const channelId = await resolveTargetChannelId({
    discordChannelId: sub.discordChannelId ?? null,
    guildId: sub.guildId ?? null,
  });
  if (!channelId) return false;
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch || !('isTextBased' in ch) || !ch.isTextBased()) return false;
  await (ch as any).send({ embeds: [embed] }).catch(() => {});
  return true;
}

/* ------------------------ YouTube ticker ------------------------ */
export async function tickYouTube(client: Client) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return;

  const subs = await prisma.streamSub.findMany({ where: { platform: 'youtube' } });
  dlog('tickYouTube: subs', subs.length);

  for (const sub of subs) {
    const channelId = sub.channelKey; // UCxxxx
    // Search for current live video
    const u = new URL('https://www.googleapis.com/youtube/v3/search');
    u.searchParams.set('part', 'snippet');
    u.searchParams.set('channelId', channelId);
    u.searchParams.set('eventType', 'live');
    u.searchParams.set('type', 'video');
    u.searchParams.set('maxResults', '1');
    u.searchParams.set('key', key);

    let liveVideoId: string | null = null;
    let title: string | undefined;

    try {
      const res = await fetch(u.toString());
      if (res.ok) {
        const json = await res.json();
        const item = json?.items?.[0];
        liveVideoId = item?.id?.videoId ?? null;
        title = item?.snippet?.title;
      } else {
        dlog('yt http error', res.status, await res.text().catch(() => ''));
      }
    } catch (e) {
      dlog('yt fetch error', e);
    }

    const isNowLive = Boolean(liveVideoId);

    if (isNowLive) {
      // suppress only if we already notified THIS videoId
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
      // mark live
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
export async function tickTwitch(client: Client) {
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
    const json = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(json));
    access = json.access_token;
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

  // Query streams for those users
  const userIds = Object.values(byLogin).map((u: any) => u.id).filter(Boolean);
  if (userIds.length) {
    const streamsRes = await fetch(
      'https://api.twitch.tv/helix/streams?' +
        new URLSearchParams(userIds.map(id => ['user_id', String(id)])),
      { headers: { 'Client-Id': clientId, Authorization: `Bearer ${access}` } }
    );
    const streamsJson = await streamsRes.json().catch(() => ({} as any));
    const liveByUserId: Record<string, any> = {};
    for (const s of streamsJson?.data ?? []) liveByUserId[s.user_id] = s;

    for (const sub of subs) {
      const user = byLogin[sub.channelKey?.toLowerCase() || ''];
      if (!user) continue;
      const live = liveByUserId[user.id] || null;

      if (live) {
        // Use stream id as unique live session id
        const streamId = String(live.id);
        const title = live.title as string | undefined;
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
export function attachLiveNotifier(client: Client) {
  const run = async () => {
    try {
      await Promise.allSettled([
        tickYouTube(client),
        tickTwitch(client),
      ]);
    } catch (e) {
      console.error('[live] tick error', e);
    }
  };
  run(); // initial
  setInterval(run, PERIOD_MS);
  console.log('[live] notifier attached. period=', PERIOD_MS, 'ms');
}
