import { SlashCommandBuilder } from "discord.js";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function resolveGame(season:number, week:number, home:string, away:string){
  const homeCoach = await prisma.coach.findFirst({ where:{ team: { equals: home, mode:"insensitive" } } });
  const awayCoach = await prisma.coach.findFirst({ where:{ team: { equals: away, mode:"insensitive" } } });
  if (!homeCoach || !awayCoach) return null;
  return prisma.game.findFirst({ where:{ season, week, homeCoachId: homeCoach.id, awayCoachId: awayCoach.id } });
}
async function pickLine(season:number, week:number, home:string, away:string){
  return prisma.line.findFirst({ where:{ season, week, homeTeam:{ equals: home, mode:"insensitive" }, awayTeam:{ equals: away, mode:"insensitive" } }, orderBy:{ id:"desc" } });
}
export const command = {
  data: new SlashCommandBuilder().setName("bet").setDescription("Place a bet (spread, ml, total) using Google Sheet lines")
    .addStringOption(o=>o.setName("market").setDescription("spread|ml|total").setRequired(true))
    .addStringOption(o=>o.setName("home").setDescription("Home team").setRequired(true))
    .addStringOption(o=>o.setName("away").setDescription("Away team").setRequired(true))
    .addIntegerOption(o=>o.setName("season").setDescription("Season").setRequired(true))
    .addIntegerOption(o=>o.setName("week").setDescription("Week").setRequired(true))
    .addStringOption(o=>o.setName("side").setDescription("home|away|over|under").setRequired(true))
    .addIntegerOption(o=>o.setName("amount").setDescription("Stake").setRequired(true)),
  async execute(interaction:any){
    const market = (interaction.options.getString("market", true) as string).toLowerCase();
    const home = interaction.options.getString("home", true);
    const away = interaction.options.getString("away", true);
    const season = interaction.options.getInteger("season", true);
    const week = interaction.options.getInteger("week", true);
    const side = (interaction.options.getString("side", true) as string).toLowerCase();
    const amount = interaction.options.getInteger("amount", true);
    if (!["spread","ml","total"].includes(market)){ await interaction.reply({ content:"Market must be spread|ml|total", ephemeral:true }); return; }
    if (amount <= 0){ await interaction.reply({ content:"Amount must be > 0", ephemeral:true }); return; }
    const me = await prisma.coach.findUnique({ where:{ discordId: interaction.user.id } });
    if (!me){ await interaction.reply({ content:"Run `/setteam` first.", ephemeral:true }); return; }
    let wallet = await prisma.wallet.findUnique({ where:{ coachId: me.id } });
    if (!wallet) wallet = await prisma.wallet.create({ data:{ coachId: me.id, balance: 0 } });
    if (wallet.balance < amount){ await interaction.reply({ content:"Insufficient DIC$ balance.", ephemeral:true }); return; }
    const line = await pickLine(season, week, home, away);
    if (!line){ await interaction.reply({ content:"No line found. Ask an admin to run /adminbank linessync.", ephemeral:true }); return; }
    if (line.cutoff && new Date() > line.cutoff){ await interaction.reply({ content:"Betting is closed for this game.", ephemeral:true }); return; }
    const game = await resolveGame(season, week, home, away);
    const snap = await prisma.betLineSnapshot.create({ data:{ spread: line.spread as any, total: line.total as any, homeML: line.homeML as any, awayML: line.awayML as any, cutoff: line.cutoff as any } });
    await prisma.wallet.update({ where:{ coachId: me.id }, data:{ balance: wallet.balance - amount } });
    let price: number | null = null; let storedLine: number | null = null;
    if (market==="spread"){ price = -110; storedLine = line.spread ?? null; }
    if (market==="total"){ price = -110; storedLine = line.total ?? null; }
    if (market==="ml"){ price = (side==="home"? line.homeML : line.awayML) ?? null; }
    const bet = await prisma.bet.create({ data:{ coachId: me.id, season, week, gameId: game?.id || null, market, side, line: storedLine as any, price: price as any, amount, snapshotId: snap.id } });
    await interaction.reply(`Bet #${bet.id} placed: ${market.toUpperCase()} ${home} vs ${away} [${side}] — amount DIC$ ${amount}`);
  }
} as const;
