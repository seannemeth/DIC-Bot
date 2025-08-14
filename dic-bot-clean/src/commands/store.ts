import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export const command = {
  data: new SlashCommandBuilder()
    .setName('store')
    .setDescription('DIC Store')
    .addSubcommand(sc => sc.setName('view').setDescription('Browse items'))
    .addSubcommand(sc => sc.setName('buy')
      .setDescription('Buy an item by id')
      .addStringOption(o=>o.setName('item_id').setDescription('e.g. jersey').setRequired(true)))
    .addSubcommand(sc => sc.setName('add').setDescription('Admin: add item')
      .addStringOption(o=>o.setName('item_id').setRequired(true))
      .addStringOption(o=>o.setName('name').setRequired(true))
      .addIntegerOption(o=>o.setName('price').setRequired(true))
      .addStringOption(o=>o.setName('description').setRequired(true)))
    .addSubcommand(sc => sc.setName('remove').setDescription('Admin: remove item')
      .addStringOption(o=>o.setName('item_id').setRequired(true))),
  async execute(interaction: any){
    const sub = interaction.options.getSubcommand();
    if (sub === 'view') {
      const items = await prisma.item.findMany({ orderBy: { price: 'asc' } });
      const lines = items.map(i => `**${i.id}** — ${i.name} (DIC$ ${i.price})\n${i.description}`);
      const embed = new EmbedBuilder().setTitle('🏪 DIC Store').setDescription(lines.join('\n\n') || 'No items yet.');
      await interaction.reply({ embeds:[embed] });
      return;
    }
    if (sub === 'buy') {
      const itemId = interaction.options.getString('item_id', true);
      const item = await prisma.item.findUnique({ where: { id: itemId } });
      if (!item) { await interaction.reply({ content: 'Item not found.', ephemeral: true }); return; }
      const coach = await prisma.coach.findUnique({ where: { discordId: interaction.user.id } });
      if (!coach) { await interaction.reply({ content: 'Run /setteam first.', ephemeral: true }); return; }
      const wallet = await prisma.wallet.upsert({ where:{ coachId: coach.id }, update:{}, create:{ coachId: coach.id, balance: 500 } });
      if (wallet.balance < item.price) { await interaction.reply({ content: `Insufficient funds. You have DIC$ ${wallet.balance}.`, ephemeral:true }); return; }
      await prisma.wallet.update({ where:{ coachId: coach.id }, data:{ balance: { decrement: item.price } } });
      await prisma.purchase.create({ data:{ coachId: coach.id, itemId: item.id, price: item.price } });
      await interaction.reply(`✅ Purchased **${item.name}** for DIC$ ${item.price}.`);
      return;
    }
    if (sub === 'add' || sub === 'remove') {
      if (!interaction.memberPermissions?.has('Administrator')) { await interaction.reply({ content:'Admin only.', ephemeral:true }); return; }
      if (sub === 'add') {
        const id = interaction.options.getString('item_id', true);
        const name = interaction.options.getString('name', true);
        const price = interaction.options.getInteger('price', true);
        const description = interaction.options.getString('description', true);
        await prisma.item.upsert({ where:{ id }, update:{ name, price, description }, create:{ id, name, price, description } });
        await interaction.reply(`✅ Added/updated **${id}** — ${name} (DIC$ ${price})`);
      } else {
        const id = interaction.options.getString('item_id', true);
        await prisma.item.delete({ where:{ id } });
        await interaction.reply(`🗑️ Removed **${id}** from the store.`);
      }
    }
  }
} as const;
