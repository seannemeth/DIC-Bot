import { SlashCommandBuilder } from 'discord.js';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function findGame(season:number, week:number, home:string, away:string){
  const h = await prisma.coach.findFirst({ where:{ team:{ equals: home, mode:'insensitive' } } });
  const a = await prisma.coach.findFirst({ where:{ team:{ equals: away, mode:'insensitive' } } });
  if (!h || !a) return null;
  return prisma.game.findFirst({ where:{ season, week, homeCoachId:h.id, awayCoachId:a.id } });
}

export const command = {
  data: new SlashCommandBuilder().setName('bet').setDescription('Place a bet using lines from Google Sheet')
    .addStringOption(o=>o.setName('market').setDescription('spread|ml|total').setRequired(true))
    .addStringOption(o=>o.setName('home').setDescription('Home team').setRequired(true))
    .addStringOption(o=>o.setName('away').setDescription('Away team').setRequired(true))
    .addIntegerOption(o=>o.setName('season').setDescription('Season').setRequired(true))
    .addIntegerOption(o=>o.setName('week').setDescription('Week').setRequired(true))
    .addStringOption(o=>o.setName('side').setDescription('home|away|over|under').setRequired(true))
    .addIntegerOption(o=>o.setName('amount').setDescription('DIC$ amount').setRequired(true)),
  async execute(interaction:any){
    const market = String(interaction.options.getString('market', true)).toLowerCase();
    const home = interaction.options.getString('home', true);
    const away = interaction.options.getString('away', true);
    const season = interaction.options.getInteger('season', true);
    const week = interaction.options.getInteger('week', true);
    const side = String(interaction.options.getString('side', true)).toLowerCase();
    const amount = interaction.options.getInteger('amount', true);
    if (!['spread','ml','total'].includes(market)){ await interaction.reply({ content:'market must be spread|ml|total', ephemeral:true }); return; }
    if (amount <= 0){ await interaction.reply({ content:'amount must be > 0', ephemeral:true }); return; }
    const me = await prisma.coach.findUnique({ where:{ discordId: interaction.user.id } });
    if (!me){ await interaction.reply({ content:'Run /setteam first.', ephemeral:true }); return; }
    const w = await prisma.wallet.upsert({ where:{ coachId: me.id }, update:{}, create:{ coachId: me.id, balance: 0 } });
    if (w.balance < amount){ await interaction.reply({ content:'Insufficient DIC$ balance.', ephemeral:true }); return; }
    const line = await prisma.line.findFirst({ where:{ season, week, homeTeam:{ equals: home, mode:'insensitive' }, awayTeam:{ equals: away, mode:'insensitive' } }, orderBy:{ id:'desc' } });
    if (!line){ await interaction.reply({ content:'No line found; ask admin to run /adminbank linessync.', ephemeral:true }); return; }
    if (line.cutoff && new Date() > line.cutoff){ await interaction.reply({ content:'Betting is closed for this game.', ephemeral:true }); return; }
    const game = await findGame(season, week, home, away);
    let price:number|null = null, storedLine:number|null = null;
    if (market==='spread'){ price = -110; storedLine = line.spread ?? null; }
    if (market==='total'){ price = -110; storedLine = line.total ?? null; }
    if (market==='ml'){ price = side==='home' ? (line.homeML ?? null) : (line.awayML ?? null); }
    await prisma.wallet.update({ where:{ coachId: me.id }, data:{ balance: { decrement: amount } } });
    const bet = await prisma.bet.create({ data:{ coachId: me.id, season, week, gameId: game?.id || null, market, side, line: storedLine as any, price: price as any, amount } });
    await interaction.reply(`Bet #${bet.id} placed: ${market.toUpperCase()} ${home} vs ${away} [${side}] — DIC$ ${amount}`);
  }
} as const;
