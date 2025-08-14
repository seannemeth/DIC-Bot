import 'dotenv/config';
import { Client, GatewayIntentBits, Collection, Interaction, REST, Routes } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { startWebServer } from './web/server';

// Commands
import * as SetTeam from './commands/setteam';
import * as Standings from './commands/standings';
import * as Leaderboard from './commands/leaderboard';

const prisma = new PrismaClient();
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
}) as any;

const commands = new Collection<string, any>();
[SetTeam, Standings, Leaderboard].forEach((m) => commands.set(m.command.data.name, m.command));

client.once('ready', async () => {
  console.log(`Logged in as ${client.user?.tag}`);
  await startWebServer(prisma);
});

client.on('interactionCreate', async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = commands.get(interaction.commandName);
  if (!cmd) return;
  try {
    await cmd.execute(interaction);
  } catch (e) {
    console.error(e);
    if (interaction.isRepliable()) {
      const ephemeral: any = { content: 'Oops, command error.', ephemeral: true };
      // @ts-ignore
      if (interaction.replied || interaction.deferred) await interaction.followUp(ephemeral);
      else await interaction.reply(ephemeral);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
