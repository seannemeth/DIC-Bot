import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

function pendingEmbed(game: any) {
  return new EmbedBuilder().setTitle(`Week ${game.week}: ${game.homeTeam} vs ${game.awayTeam}`)
    .setDescription(`Final (pending): **${game.homeTeam} ${game.homePts} – ${game.awayPts} ${game.awayTeam}**\nOpponent must confirm.`).setColor(0xf1c40f);
}

export const command = {
  data: new SlashCommandBuilder().setName('postscore').setDescription('Report a final score vs an opponent')
    .addIntegerOption(o=>o.setName('my').setDescription('Your points').setRequired(true))
    .addIntegerOption(o=>o.setName('opp').setDescription('Opponent points').setRequired(true))
    .addUserOption(o=>o.setName('opp_user').setDescription('Opponent user').setRequired(true))
    .addIntegerOption(o=>o.setName('week').setDescription('Week').setRequired(false))
    .addIntegerOption(o=>o.setName('season').setDescription('Season').setRequired(false)),
  async execute(interaction:any){
    const myPts = interaction.options.getInteger('my', true);
    const oppPts = interaction.options.getInteger('opp', true);
    const oppUser = interaction.options.getUser('opp_user', true);
    const week = interaction.options.getInteger('week') ?? 1;
    const season = interaction.options.getInteger('season') ?? 1;
    const me = await prisma.coach.findUnique({ where:{ discordId: interaction.user.id } });
    const opp = await prisma.coach.findUnique({ where:{ discordId: oppUser.id } });
    if (!me?.team || !opp?.team) { await interaction.reply({ content:'Both coaches must run `/setteam` first.', ephemeral:true }); return; }
    const game = await prisma.game.create({ data:{ season, week, homeCoachId: me.id, awayCoachId: opp.id, homeTeam: me.team, awayTeam: opp.team, homePts: myPts, awayPts: oppPts, status:'pending', reportedById: me.id } });
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`confirm:${game.id}`).setLabel('Confirm').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`dispute:${game.id}`).setLabel('Dispute').setStyle(ButtonStyle.Danger)
    );
    const sent = await interaction.reply({ embeds:[pendingEmbed(game)], components:[row], fetchReply:true });
    await prisma.game.update({ where:{ id: game.id }, data:{ messageId: sent.id, channelId: sent.channelId } });
  }
} as const;
