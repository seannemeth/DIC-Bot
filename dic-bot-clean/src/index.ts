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
import * as Lines from './commands/lines';        // stub or implemented
import * as PlaceBet from './commands/placebet';  // stub or implemented
import * as SetTeam from './commands/setteam';
import * as PostScore from './commands/postscore';
import * as Standings from './commands/standings';
import * as Leaderboard from './commands/leaderboard';
import * as Balance from './commands/balance';
import * as ResetCoins from './commands/resetcoins';

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
  PlaceBet
].forEach((m: any) => commands.set(m.command.data.name, m.command));

client.once('ready', async () => {
  console.log(`Logged in as ${client.user?.tag}`);

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

client.login(process.env.DISCORD_TOKEN);
