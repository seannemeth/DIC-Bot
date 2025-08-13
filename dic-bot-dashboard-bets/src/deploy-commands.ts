import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";
import * as SetTeam from "./commands/setteam.js";
import * as PostScore from "./commands/postscore.js";
import * as Standings from "./commands/standings.js";
import * as H2H from "./commands/h2h.js";
import * as Recap from "./commands/recap.js";
import * as Preview from "./commands/preview.js";
import * as Roast from "./commands/roastme.js";
import * as Admin from "./commands/admin.js";
import * as AdminBank from "./commands/admin-banking.js";
import * as Bank from "./commands/bank.js";
import * as Bet from "./commands/bet.js";
import * as Leaderboard from "./commands/leaderboard.js";
import * as Redeem from "./commands/redeem.js";

const commands = [
  SetTeam.command.data,
  PostScore.command.data,
  Standings.command.data,
  H2H.command.data,
  Recap.command.data,
  Preview.command.data,
  Roast.command.data,
  Admin.command.data, AdminBank.command.data, Bank.command.data, Bet.command.data, Leaderboard.command.data, Redeem.command.data
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN!);

async function main() {
  const appId = process.env.DISCORD_APP_ID!;
  const guildId = process.env.DISCORD_GUILD_ID!;
  await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commands });
  console.log("Commands registered to guild:", guildId);
}
main().catch(console.error);
