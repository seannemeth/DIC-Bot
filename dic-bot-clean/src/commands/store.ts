import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export const command = {
  data: new SlashCommandBuilder()
    .setName('store')
    .setDescription('View or buy store items')
    .addSubcommand(sc =>
      sc.setName('list')
        .setDescription('List store items'))
    .addSubcommand(sc =>
      sc.setName('buy')
        .setDescription('Buy a store item')
        .addStringOption(o => o.setName('item').setDescription('Item key').setRequired(true))
        .addStringOption(o => o.setName('note').setDescription('Optional note'))),
  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const items = await prisma.item.findMany({ where: { enabled: true }, orderBy: { price: 'asc' } });
      if (!items.length) return interaction.reply({ content: 'No store items available.', ephemeral: true });

      const lines = items.map((i: any) =>
        `**${i.itemKey}** — ${i.name} • ${i.price} DIC$\n${i.description ?? ''}`.trim()
      );

      return interaction.reply({ content: lines.join('\n\n'), ephemeral: true });
    }

    if (sub === 'buy') {
      const coach = await prisma.coach.findUnique({ where: { discordId: interaction.user.id } });
      if (!coach) return interaction.reply({ content: '❌ You must set up first with `/setteam`.', ephemeral: true });

      const itemKey = interaction.options.getString('item', true);
      const note = interaction.options.getString('note') || null;

      const item = await prisma.item.findUnique({ where: { itemKey } });
      if (!item) return interaction.reply({ content: '❌ Item not found.', ephemeral: true });

      const wallet = await prisma.wallet.findUnique({ where: { coachId: coach.id } });
      if (!wallet || wallet.balance < item.price) {
        return interaction.reply({ content: '❌ Not enough DIC$.', ephemeral: true });
      }

      await prisma.wallet.update({
        where: { coachId: coach.id },
        data: { balance: { decrement: item.price } },
      });

      await prisma.purchase.create({
        data: {
          coachId: coach.id,
          itemId: item.itemKey,
          price: item.price,
          note,
        },
      });

      return interaction.reply({ content: `✅ Bought **${item.name}** for ${item.price} DIC$.`, ephemeral: true });
    }
  }
} as const;
