import 'dotenv/config';
import { Client, GatewayIntentBits, Collection, Interaction, ButtonInteraction, EmbedBuilder, REST, Routes } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import * as SetTeam from './commands/setteam';
import * as PostScore from './commands/postscore';
import * as Standings from './commands/standings';
import * as Leaderboard from './commands/leaderboard';
import * as Balance from './commands/balance';
import * as ResetCoins from './commands/resetcoins';
import { attachScoreListener } from './ingest/score-listener';


const commands = new Collection<string, any>();
[SetTeam, PostScore, Standings, Leaderboard, Balance, ResetCoins].forEach((m:any) => commands.set(m.command.data.name, m.command));

client.once('ready', async () => {
  console.log(`Logged in as ${client.user?.tag}`);
  // register slash commands to all guilds
  try {
    const body = Array.from(commands.values()).map((c:any)=> c.data.toJSON());
    for (const [, guild] of client.guilds.cache) {
      await guild.commands.set(body);
      console.log(`[SLASH] Registered commands for guild ${guild.name}`);
    }
  } catch (e) { console.error('[SLASH] Registration error:', e); }
  // attach score listener (emoji-based score parsing)
  attachScoreListener(client, prisma);
});

client.on('interactionCreate', async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = commands.get(interaction.commandName);
  if (!cmd) return;
  if (cmd.adminOnly && !('memberPermissions' in interaction && interaction.memberPermissions?.has('Administrator'))) {
    await interaction.reply({ content: 'Admin only.', ephemeral: true }); return;
  }
  try { await cmd.execute(interaction); }
  catch (e) { console.error(e); try {
    // @ts-ignore
    if (interaction.replied || interaction.deferred) await interaction.followUp({ content:'Command error.', ephemeral:true });
    else await interaction.reply({ content:'Command error.', ephemeral:true });
  } catch{} }
});

client.login(process.env.DISCORD_TOKEN);
