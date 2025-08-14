import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
export const command = { data: new SlashCommandBuilder().setName("redeem").setDescription("Redeem DIC$ for an attribute upgrade voucher").addStringOption(o=>o.setName("item").setDescription("Upgrade ID").setRequired(true)),
  async execute(interaction:any){
    const me = await prisma.coach.findUnique({ where:{ discordId: interaction.user.id } });
    if (!me){ await interaction.reply({ content:"Run `/setteam` first.", ephemeral:true }); return; }
    let wallet = await prisma.wallet.findUnique({ where:{ coachId: me.id } });
    if (!wallet) wallet = await prisma.wallet.create({ data:{ coachId: me.id, balance: 0 } });
    const itemId = interaction.options.getString("item", true);
    const item = await prisma.shopItem.findUnique({ where:{ id: itemId } });
    if (!item || !item.active){ await interaction.reply({ content:"Unknown or inactive upgrade ID.", ephemeral:true }); return; }
    if (wallet.balance < item.cost){ await interaction.reply({ content:`Insufficient funds. Cost: DIC$ ${item.cost}`, ephemeral:true }); return; }
    await prisma.wallet.update({ where:{ coachId: me.id }, data:{ balance: wallet.balance - item.cost } });
    const red = await prisma.redemption.create({ data:{ coachId: me.id, itemId: item.id, cost: item.cost } });
    await interaction.reply({ embeds:[ new EmbedBuilder().setTitle("Upgrade Voucher Created").setDescription(`#${red.id} — ${item.name} (DIC$ ${item.cost})`).setColor(0x8e44ad) ] });
  }
} as const;
