import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import * as SetTeam from './commands/setteam';
import * as Standings from './commands/standings';
import * as Leaderboard from './commands/leaderboard';

const appId = process.env.DISCORD_APP_ID as string;
const guildId = process.env.DISCORD_GUILD_ID as string;
const token = process.env.DISCORD_TOKEN as string;

const rest = new REST({ version: '10' }).setToken(token);

async function main() {
  const body = [SetTeam.command.data, Standings.command.data, Leaderboard.command.data].map(c => c.toJSON());
  await rest.put(Routes.applicationGuildCommands(appId, guildId), { body });
  console.log('Slash commands deployed.');
}
main().catch(console.error);
