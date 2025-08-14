import 'dotenv/config';
import { Client, GatewayIntentBits, Collection, Interaction, ButtonInteraction, EmbedBuilder } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import * as SetTeam from './commands/setteam';
import * as PostScore from './commands/postscore';
import * as Standings from './commands/standings';
import * as Leaderboard from './commands/leaderboard';
import * as AdminBank from './commands/adminbank';
import * as Bet from './commands/bet';
import { settleBetsForGame } from './lib/settlement';

const prisma = new PrismaClient();
import { startWebServer } from './web/server';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

const commands = new Collection<string, any>();
[SetTeam, PostScore, Standings, Leaderboard, AdminBank, Bet].forEach((m:any) => commands.set(m.command.data.name, m.command));

client.once('ready', async () => {
  await startWebServer(prisma);
  console.log(`Logged in as ${client.user?.tag}`);
});

client.on('interactionCreate', async (interaction: Interaction) => {
  if (interaction.isChatInputCommand()) {
    const cmd = commands.get(interaction.commandName);
    if (!cmd) return;
    if (cmd.adminOnly && !('memberPermissions' in interaction && interaction.memberPermissions?.has('Administrator'))) {
      await interaction.reply({ content: 'Admin only.', ephemeral: true }); return;
    }
    try { await cmd.execute(interaction); } 
    catch (e) { console.error(e); if (interaction.isRepliable()) { // @ts-ignore
      if (interaction.replied || interaction.deferred) await interaction.followUp({ content:'Command error.', ephemeral:true });
      else await interaction.reply({ content:'Command error.', ephemeral:true }); } }
    return;
  }
  if (interaction.isButton()) {
    const btn = interaction as ButtonInteraction;
    const [kind, idStr] = btn.customId.split(':');
    const gameId = Number(idStr);
    const game = await prisma.game.findUnique({ where: { id: gameId } });
    if (!game) { await btn.reply({ content: 'Game not found.', ephemeral: true }); return; }
    if (kind === 'confirm') {
      await prisma.game.update({ where:{ id: game.id }, data:{ status: 'confirmed', confirmedById: Number(game.awayCoachId) } });
      await btn.update({ embeds: [ new EmbedBuilder().setTitle(`Week ${game.week}: ${game.homeTeam} vs ${game.awayTeam}`).setDescription(`**Final**: ${game.homeTeam} ${game.homePts} – ${game.awayPts} ${game.awayTeam}`).setColor(0x2ecc71) ], components: [] });
      if (game.id) await settleBetsForGame(prisma, game.id);
      return;
    }
    if (kind === 'dispute') {
      await prisma.game.update({ where:{ id: game.id }, data:{ status: 'disputed' } });
      await btn.update({ embeds: [ new EmbedBuilder().setTitle(`Week ${game.week}: ${game.homeTeam} vs ${game.awayTeam}`).setDescription(`**Disputed**. An admin will review.`).setColor(0xe74c3c) ], components: [] });
      return;
    }
  }
});

// Sanity check for env
for (const k of ["DISCORD_TOKEN","DISCORD_APP_ID","DISCORD_GUILD_ID","DATABASE_URL"]) {
  if (!process.env[k] || !String(process.env[k]).trim()) {
    console.error(`[CONFIG] Missing ${k}. Set it in Railway → Variables.`);
  }
}

client.login(process.env.DISCORD_TOKEN);
