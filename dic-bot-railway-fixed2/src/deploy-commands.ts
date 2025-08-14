
import 'dotenv/config';
import { REST, Routes } from 'discord.js';

import * as SetTeam from './commands/setteam.js';
import * as PostScore from './commands/postscore.js';
import * as Standings from './commands/standings.js';
import * as H2H from './commands/h2h.js';
import * as Preview from './commands/preview.js';
import * as Recap from './commands/recap.js';
import * as RoastMe from './commands/roastme.js';
import * as Admin from './commands/admin.js';
import * as AdminBank from './commands/admin-banking.js';
import * as AdminConf from './commands/adminconf.js';
import * as ConfStandings from './commands/confstandings.js';
import * as Bank from './commands/bank.js';
import * as Bet from './commands/bet.js';
import * as Leaderboard from './commands/leaderboard.js';
import * as Redeem from './commands/redeem.js';

const commands = [
  SetTeam.command.data,
  PostScore.command.data,
  Standings.command.data,
  H2H.command.data,
  Preview.command.data,
  Recap.command.data,
  RoastMe.command.data,
  Admin.command.data,
  AdminBank.command.data,
  AdminConf.command.data,
  ConfStandings.command.data,
  Bank.command.data,
  Bet.command.data,
  Leaderboard.command.data,
  Redeem.command.data,
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);

async function main() {
  const appId = process.env.DISCORD_APP_ID!;
  if (!appId) throw new Error('Missing DISCORD_APP_ID');
  const guildId = process.env.DISCORD_GUILD_ID;
  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commands });
    console.log('Registered guild commands.');
  } else {
    await rest.put(Routes.applicationCommands(appId), { body: commands });
    console.log('Registered global commands (can take up to 1 hour).');
  }
}
main().catch(e => { console.error(e); process.exit(1); });
