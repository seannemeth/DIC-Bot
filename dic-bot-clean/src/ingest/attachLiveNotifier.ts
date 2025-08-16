// src/ingest/attachLiveNotifier.ts
import { Client, EmbedBuilder } from 'discord.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PERIOD_MS = Number(process.env.LIVE_ALERT_PERIOD_MS || 60_000);
const DEBUG_LIVE = process.env.LIVE_ALERT_DEBUG === '1';
const dlog = (...a: unknown[]) => { if (DEBUG_LIVE) console.log('[live]', ...a); };

// ------------ helpers ------------
async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = text; }
  return { ok: res.ok, status: res.status, json };
}

async function postAlert(client: Client, sub: any, embed: EmbedBuilder): Promise<boolean> {
  // priority: per-sub channel -> per-guild default -> env fallback
  let channelId: string | null = sub.discordChannelId || null;

  if (!channelId && sub.guildId) {
    try {
      const row = await prisma.liveAlertDefault.findUnique({ where: { guildId: sub.guildId } });
      if (row?.channelId) channelId = row.channelId;
    } catch {}
  }

  if (!channelId) channelId = process.env.LIVE_ALERT_CHANNEL_ID ?? null;

  dlog('postAlert resolve', { platform: sub.platform, key: sub.channelKey, channelId });

  if (!channelId) return false;
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch || !('isTextBased' in ch) || !ch.isTextBased()) return false;
  await (ch as any).send({ embeds: [embed] }).catch(() => {});
  return true;
}

// ------------ YouTube ------------
/**
 * Robust live detection strategy:
 * 1) Try strict: search?eventType=live&type=video
 * 2) If none, fetch latest 5 videos, then call videos?part=snippet,liveStreamingDetails
 *    and detect live by either snippet.liveBroadcastContent === 'live' OR
 *    liveStreamingDetails.actualStartTime being present.
 */
export async function tickYouTube(client: Client) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return;

  const subs = await prisma.streamSub.findMany({ where: { platform: 'youtube' } });
  dlog('tickYouTube: subs', subs.length);

  for (const sub of subs) {
    const channelId = sub.channelKey as string;

    let liveVideoId: string | null = null;
    let title: string | undefined;

    // (A) strict live
    try {
      const u = new URL('https://www.googleapis.com/youtube/v3/search');
      u.searchParams.set('part', 'snippet');
      u.searchParams.set('channelId', channelId);
      u.searchParams.set('eventType', 'live');
      u.searchParams.set('type', 'video');
      u.searchParams.set('maxResults', '1');
      u.searchParams.set('key', key);
      const r = await fetchJson(u.toString());
      if (r.ok) {
        const item = r.json?.items?.[0];
        liveVideoId = item?.id?.videoId ?? null;
        title = item?.snippet?.title;
      } else {
        dlog('yt strict err', r.status, r.json);
      }
    } catch (e) {
      dlog('yt strict fetch error', e);
    }

    // (B) latest N -> videos details
    if (!liveVideoId) {
      try {
        const u2 = new URL('https://www.googleapis.com/youtube/v3/search');
        u2.searchParams.set('part', 'snippet');
        u2.searchParams.set('channelId', channelId);
        u2.searchParams.set('type', 'video');
        u2.searchParams.set('order', 'date');
        u2.searchParams.set('maxResults', '5'); // check a few in case uploads are noisy
        u2.searchParams.set('key', key);
        const r2 = await fetchJson(u2.toString());
        if (r2.ok && Array.isArray(r2.json?.items) && r2.json.items.length) {
          const ids: string[] = r2.json.items
            .map((it: any) => it?.id?.videoId)
            .filter(Boolean);

          if (ids.length) {
            const u3 = new URL('https://www.googleapis.com/youtube/v3/videos');
            u3.searchParams.set('part', 'snippet,liveStreamingDetails');
            u3.searchParams.set('id', ids.join(','));
            u3.searchParams.set('key', key);
            const r3 = await fetchJson(u3.toString());
            if (r3.ok) {
              for (const v of r3.json?.items ?? []) {
                const liveFlag = v?.snippet?.liveBroadcastContent === 'live';
                const started = Boolean(v?.liveStreamingDetails?.actualStartTime);
                if (liveFlag || started) {
                  liveVideoId = v.id;
                  title = v?.snippet?.title;
                  break;
                }
              }
            } else {
              dlog('yt videos err', r3.status, r3.json);
            }
          }
        } else {
          dlog('yt latest err', r2.status, r2.json);
        }
      } catch (e) {
        dlog('yt fallback fetch error', e);
      }
    }

    const isNowLive = Boolean(liveVideoId);
    dlog('yt verdict', { key: channelId, isNowLive, liveVideoId, prev: { isLive: sub.isLive, last: sub.lastItemId } });

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
        dlog('yt post', channelId, { posted, liveVideoId });
      }
      await prisma.streamSub.update({
        where: { platform_channelKey: { platform: 'youtube', channelKey: channelId } },
        data: { isLive: true, lastItemId: liveVideoId || undefined },
      }).catch(() => {});
    } else if (sub.isLive || sub.lastItemId) {
      // reset so next go-live notifies again
      await prisma.streamSub.update({
        where: { platform_channelKey: { platform: 'youtube', channelKey: channelId } },
        data: { isLive: false, lastItemId: null },
      }).catch(() => {});
      dlog('yt reset', channelId);
    }
  }
}

// ------------ Twitch ------------
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
    access = json.access_token as string;
  } catch (e) {
    dlog('tw token error', e);
    return;
  }

  const subs = await prisma.streamSub.findMany({ where: { platform: 'twitch' } });
  dlog('tickTwitch: subs', subs.length);

  const logins = subs.map(s => String(s.channelKey || '')).filter(Boolean);
  if (!logins.length) return;

  const ur = await fetch(
    'https://api.twitch.tv/helix/users?' + new URLSearchParams(logins.map(l => ['login', l])),
    { headers: { 'Client-Id': clientId, Authorization: `Bearer ${access}` } }
  );
  const uj = await ur.json().catch(() => ({} as any));
  const byLogin: Record<string, any> = {};
  for (const u of uj?.data ?? []) byLogin[String(u.login || '').toLowerCase()] = u;

  const userIds = Object.values(byLogin).map((u: any) => String(u.id));
  if (userIds.length) {
    const sr = await fetch(
      'https://api.twitch.tv/helix/streams?' + new URLSearchParams(userIds.map(id => ['user_id', id])),
      { headers: { 'Client-Id': clientId, Authorization: `Bearer ${access}` } }
    );
    const sj = await sr.json().catch(() => ({} as any));

    const liveByUserId: Record<string, any> = {};
    for (const s of sj?.data ?? []) liveByUserId[String(s.user_id)] = s;

    for (const sub of subs) {
      const login = String(sub.channelKey || '').toLowerCase();
      const user = byLogin[login];
      if (!user) continue;

      const live = liveByUserId[String(user.id)] || null;
      const isNowLive = Boolean(live);
      dlog('tw verdict', { login, isNowLive, streamId: live ? String(live.id) : null, prev: { isLive: sub.isLive, last: sub.lastItemId } });

      if (live) {
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
          dlog('tw post', login, { posted, streamId });
        }

        await prisma.streamSub.update({
          where: { platform_channelKey: { platform: 'twitch', channelKey: sub.channelKey } },
          data: { isLive: true, lastItemId: streamId },
        }).catch(() => {});
      } else if (sub.isLive || sub.lastItemId) {
        await prisma.streamSub.update({
          where: { platform_channelKey: { platform: 'twitch', channelKey: sub.channelKey } },
          data: { isLive: false, lastItemId: null },
        }).catch(() => {});
        dlog('tw reset', login);
      }
    }
  }
}

// ------------ Attacher ------------
export function attachLiveNotifier(client: Client) {
  const run = async () => {
    try {
      await Promise.allSettled([tickYouTube(client), tickTwitch(client)]);
    } catch (e) {
      console.error('[live] tick error', e);
    }
  };
  run(); // initial tick
  setInterval(run, PERIOD_MS);
  console.log('[live] notifier attached. period=', PERIOD_MS, 'ms');
}
