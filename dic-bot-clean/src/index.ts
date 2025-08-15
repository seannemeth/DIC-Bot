// src/index.ts
import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Collection,
  Interaction
} from 'discord.js';
import { PrismaClient } from '@prisma/client';

// === Commands ===
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

// === Emoji score listener ===
import { attachScoreListener } from './ingest/score-listener';

const prisma = new PrismaClient();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    // Keep this ON only if you enabled "Message Content Intent" in the Dev Portal
    GatewayIntentBits.MessageContent
  ]
});

// Collect all command modules here
const commands = new Collection<string, any>();
[
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
  schedule,
  scheduleImport,
// src/index.ts (only the relevant bits)
import { Client, Collection, GatewayIntentBits } from "discord.js";
import { loadCommandsFromDist } from "./commandLoader";

// ... your existing client/login setup ...

// Build the commands collection safely
const commands = new Collection<string, any>();
const loaded = loadCommandsFromDist();
for (const [name, cmd] of loaded.entries()) {
  commands.set(name, cmd);
}

// Optionally expose it on client for use elsewhere
// (client as any).commands = commands;

// When you handle interactions, use the safe map:
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = commands.get(interaction.commandName);
  if (!cmd) {
    await interaction.reply({ content: "Command not found.", ephemeral: true }).catch(() => {});
    return;
  }
  try {
    await cmd.execute(interaction);
  } catch (err) {
    console.error(`[cmd:${interaction.commandName}]`, err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply("❌ Something went wrong.").catch(() => {});
    } else {
      await interaction.reply({ content: "❌ Something went wrong.", ephemeral: true }).catch(() => {});
    }
  }
});


client.once('ready', async () => {
  console.log(`Logged in as ${client.user?.tag}`);

  // Diagnose which command is invalid
  for (const [name, cmd] of commands) {
    try {
      cmd.data.toJSON();
    } catch (e) {
      console.error('[SLASH BUILD ERROR] in command:', name, e);
    }
  }

  // Register slash commands for each guild the bot is in
  try {
    const body = Array.from(commands.values()).map((c: any) => c.data.toJSON());
    for (const [, guild] of client.guilds.cache) {
      await guild.commands.set(body);
      console.log(`[SLASH] Registered commands for guild: ${guild.name}`);
    }
  } catch (e) {
    console.error('[SLASH] Registration error:', e);
  }

  // Attach emoji-based score listener (needs SCORES_CHANNEL_ID + Message Content Intent)
  attachScoreListener(client, prisma);
});

client.on('interactionCreate', async (interaction: Interaction) => {
  // ✅ Autocomplete support
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
  if (!cmd) return;

  // Simple admin gate if a command marks itself adminOnly
  if (cmd.adminOnly && !('memberPermissions' in interaction && interaction.memberPermissions?.has('Administrator'))) {
    await interaction.reply({ content: 'Admin only.', ephemeral: true });
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
  throw new Error('DISCORD_TOKEN looks wrong (should contain dots). Did you paste the bot token from the Bot tab?');
}
client.login(process.env.DISCORD_TOKEN);
