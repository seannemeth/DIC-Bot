import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export const command = {
  data: new SlashCommandBuilder()
    .setName('buy')
    .setDescription('Buy a store item with your DIC$')
    .addStringOption(o => o.setName('item_id').setDescription('Store ItemId (from /store list)').setRequired(true))
    .addIntegerOption(o => o.setName('qty').setDescription('Quantity').setMinValue(1).setRequired(false)),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const itemKey = interaction.options.getString('item_id', true).trim();
    const qty = interaction.options.getInteger('qty') ?? 1;

    const coach = await prisma.coach.findUnique({ where: { discordId: interaction.user.id } });
    if (!coach) return interaction.editReply('❌ You must set up first with `/setteam`.');

    const wallet = await prisma.wallet.upsert({
      where: { coachId: coach.id },
      create: { coachId: coach.id, balance: 500 },
      update: {},
    });

    const item = await prisma.item.findUnique({ where: { itemKey } });
    if (!item || !item.enabled) return interaction.editReply('❌ Item not found or disabled.');

    const cost = item.price * qty;
    if (wallet.balance < cost) return interaction.editReply(`❌ Need ${cost} DIC$, you have ${wallet.balance}.`);

    // charge
    await prisma.wallet.update({
      where: { coachId: coach.id },
      data: { balance: { decrement: cost } },
    });

    // effects
    if (item.type === 'COINS') {
      const credit = Number((item.payload as any)?.credit ?? 0) * qty;
      await prisma.wallet.update({
        where: { coachId: coach.id },
        data: { balance: { increment: credit } },
      });
      return interaction.editReply(`✅ Purchased **${item.name}** x${qty}. Credited **${credit} DIC$**.`);
    }

    // inventory entry
    await prisma.purchase.create({
      data: { coachId: coach.id, itemId: item.id, qty },
    });

    return interaction.editReply(`✅ Purchased **${item.name}** x${qty}. Use \`/inventory\` or \`/redeem\`.`);
  }
} as const;
