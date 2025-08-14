
import 'dotenv/config';
import { REST, Routes } from 'discord';

import * as SetTeam from './commands/setteam';
import * as PostScore from './commands/postscore';
import * as Standings from './commands/standings';
import * as H2H from './commands/h2h';
import * as Preview from './commands/preview';
import * as Recap from './commands/recap';
import * as RoastMe from './commands/roastme';
import * as Admin from './commands/admin';
import * as AdminBank from './commands/admin-banking';
import * as AdminConf from './commands/adminconf';
import * as ConfStandings from './commands/confstandings';
import * as Bank from './commands/bank';
import * as Bet from './commands/bet';
import * as Leaderboard from './commands/leaderboard';
import * as Redeem from './commands/redeem';

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
