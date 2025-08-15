// src/index.ts
import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Collection,
  Interaction,
} from 'discord.js';
import { PrismaClient } from '@prisma/client';

// === Commands (explicit imports) ===
import * as Store from './commands/store';
import * as Inventory from './commands/inventory';
import * as Lines from './commands/lines';
import * as PlaceBet from './commands/placebet';
import * as SetTeam from './commands/setteam';
import * as PostScore from './commands/postscore';
import * as Standings from './commands/standings';
import * as Leaderboard from './commands/leaderboard';
import * as Balance from './commands/balance';
import * as ResetCoins from './commands/resetcoins';
import * as PowerRankings from './commands/powerrankings';
import * as Settle from './commands/settle';
import * as Buy from './commands/buy';
import * as Redeem from './commands/redeem';
import { command as schedule } from './commands/schedule';
import { command as scheduleImport } from './commands/scheduleImport';
import { command as scoresImport } from './commands/scoresImport';
import { command as storeSync } from './commands/store_sync';

// === Emoji score listener ===
import { attachScoreListener } from './ingest/score-listener';

const prisma = new PrismaClient();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    // Keep this ON only if you enabled "Message Content Intent" in the Dev Portal
    GatewayIntentBits.MessageContent,
  ],
});

// Utility to normalize different export styles
function resolveCommand(mod: any) {
  return mod?.command ?? mod?.default?.command ?? mod?.default ?? mod;
}

// Collect all commands safely
const commands = new Collection<string, any>();
const modules = [
  SetTeam,
  PostScore,
  Standings,
  Leaderboard,
  Balance,
  ResetCoins,
  Store,
  Inventory,
  Lines,
  PlaceBet,
  PowerRankings,
  Settle,
  Buy,
  Redeem,
  // These two are imported directly as { command }
  { command: schedule },
  { command: scheduleImport },
  { command: scoresImport },
  { command: storeSync }, 
];

for (const m of modules) {
  const c = resolveCommand(m);
  if (c?.data?.name && typeof c.execute === 'function') {
    commands.set(c.data.name, c);
  } else {
    const keys = Object.keys(m || {});
    console.warn(
      `[commands] Skipping a module — expected { command: { data, execute } }. Got keys: ${keys.join(', ')}`
    );
  }
}

// ---- helpers to fix option order and debug offending commands ----
type CmdJSON = {
  name: string;
  description?: string;
  options?: any[];
  type?: number;
};

function sortOptionsRequiredFirst(options?: any[]): any[] | undefined {
  if (!Array.isArray(options)) return options;
  const req = options.filter(o => o?.required === true);
  const opt = options.filter(o => o?.required !== true);
  return [...req, ...opt];
}

function fixOptionsOrderRecursive(node: any): any {
  if (!node || typeof node !== 'object') return node;
  const out = { ...node };
  if (Array.isArray(out.options)) {
    out.options = out.options.map((child: any) => fixOptionsOrderRecursive(child));
    out.options = sortOptionsRequiredFirst(out.options);
  }
  return out;
}

function summarizeOptions(node: any, prefix = ''): string[] {
  const lines: string[] = [];
  const opts: any[] = Array.isArray(node?.options) ? node.options : [];
  if (opts.length) {
    lines.push(`${prefix}options (${opts.length}): ${opts.map(o => `${o.name}${o.required ? '*' : ''}`).join(', ')}`);
    for (const child of opts) {
      // 1 = SUB_COMMAND, 2 = SUB_COMMAND_GROUP
      if (child?.type === 1 || child?.type === 2) {
        lines.push(...summarizeOptions(child, prefix + '  '));
      }
    }
  }
  return lines;
}
// ------------------------------------------------------------------

client.once('ready', async () => {
  console.log(`Logged in as ${client.user?.tag}`);

  // Diagnose invalid command definitions
  for (const [name, cmd] of commands) {
    try {
      cmd.data.toJSON();
    } catch (e) {
      console.error('[SLASH BUILD ERROR] in command:', name, e);
    }
  }

  // Register slash commands per guild with required-first option ordering
  try {
    const list = Array.from(commands.values());
    const rawBodies: CmdJSON[] = list.map((c: any) => c.data.toJSON());
    const fixedBodies: CmdJSON[] = rawBodies.map(fixOptionsOrderRecursive);

    console.log('[SLASH] Command ordering preview:');
    fixedBodies.forEach((b, i) => {
      console.log(`  ${i}. /${b.name}`);
      summarizeOptions(b).forEach(line => console.log('     ' + line));
    });

    for (const [, guild] of client.guilds.cache) {
      await guild.commands.set(fixedBodies as any);
      console.log(`[SLASH] Registered commands for guild: ${guild.name}`);
    }
  } catch (e) {
    console.error('[SLASH] Registration error:', e);
  }

  // Attach emoji-based score listener (needs SCORES_CHANNEL_ID + Message Content Intent)
  attachScoreListener(client, prisma);
});

client.on('interactionCreate', async (interaction: Interaction) => {
  // Autocomplete support
  if (interaction.isAutocomplete()) {
    const cmd = commands.get(interaction.commandName);
    if (cmd?.autocomplete) {
      try {
        await cmd.autocomplete(interaction);
      } catch (e) {
        console.error('[AC ERROR]', e);
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const cmd = commands.get(interaction.commandName);
  if (!cmd) {
    await interaction.reply({ content: 'Command not found.', ephemeral: true }).catch(() => {});
    return;
  }

  // Simple admin gate if a command marks itself adminOnly
  // @ts-ignore
  if (cmd.adminOnly && !('memberPermissions' in interaction && interaction.memberPermissions?.has('Administrator'))) {
    await interaction.reply({ content: 'Admin only.', ephemeral: true }).catch(() => {});
    return;
  }

  try {
    await cmd.execute(interaction);
  } catch (e) {
    console.error('[CMD ERROR]', e);
    try {
      // @ts-ignore
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: 'Command error.', ephemeral: true });
      } else {
        await interaction.reply({ content: 'Command error.', ephemeral: true });
      }
    } catch {}
  }
});

const token = process.env.DISCORD_TOKEN;
if (!token || typeof token !== 'string') {
  throw new Error('DISCORD_TOKEN is missing. Set it in Railway Variables.');
}
if (!token.includes('.')) {
  throw new Error('DISCORD_TOKEN looks wrong (should contain dots). Did you paste the bot token from the Bot tab?)');
}

client.login(token);
