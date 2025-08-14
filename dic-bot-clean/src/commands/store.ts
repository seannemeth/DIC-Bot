// src/commands/store.ts
import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export const command = {
  data: new SlashCommandBuilder()
    .setName('store')
    .setDescription('Browse and buy items with DIC$')
    .addSubcommand(sc =>
      sc
        .setName('view')
        .setDescription('View all items available for purchase')
    )
    .addSubcommand(sc =>
      sc
        .setName('buy')
        .setDescription('Buy an item by ID (e.g., jersey)')
        .addStringOption(o =>
          o
            .setName('item_id')
            .setDescription('The item identifier (e.g., jersey, practice)')
            .setRequired(true)
        )
        .addStringOption(o =>
          o
            .setName('note')
            .setDescription('Optional note for admins (e.g., which player)')
            .setRequired(false)
        )
    )
    .addSubcommand(sc =>
      sc
        .setName('add')
        .setDescription('Admin: add or update a store item')
        .addStringOption(o =>
          o
            .setName('item_id')
            .setDescription('Unique item ID (e.g., jersey)')
            .setRequired(true)
        )
        .addStringOption(o =>
          o
            .setName('name')
            .setDescription('Display name (e.g., Custom Jersey)')
            .setRequired(true)
        )
        .addIntegerOption(o =>
          o
            .setName('price')
            .setDescription('Price in DIC$')
            .setRequired(true)
        )
        .addStringOption(o =>
          o
            .setName('description')
            .setDescription('What does this item do?')
            .setRequired(true)
        )
    )
    .addSubcommand(sc =>
      sc
        .setName('remove')
        .setDescription('Admin: remove a store item by ID')
        .addStringOption(o =>
          o
            .setName('item_id')
            .setDescription('The item identifier to remove')
            .setRequired(true)
        )
    ),
  // optional gate for admin subs
  async execute(interaction: any) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'view') {
      const items = await prisma.item.findMany({ orderBy: { price: 'asc' } });
      const lines = items.length
        ? items.map((i: any) => `**${i.id}** — ${i.name} (DIC$ ${i.price})\n${i.description}`)
        : ['_No items yet. Ask an admin to add some with_ `/store add`'];
      const embed = new EmbedBuilder()
        .setTitle('🏪 DIC Store')
        .setDescription(lines.join('\n\n'))
        .setColor(0x00a67e);
      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (sub === 'buy') {
      const itemId = interaction.options.getString('item_id', true);
      const note = interaction.options.getString('note') ?? undefined;

      const item = await prisma.item.findUnique({ where: { id: itemId } });
      if (!item) {
        await interaction.reply({ content: '❌ Item not found.', ephemeral: true });
        return;
      }

      const coach = await prisma.coach.findUnique({ where: { discordId: interaction.user.id } });
      if (!coach) {
        await interaction.reply({ content: 'Link your team first with `/setteam`.', ephemeral: true });
        return;
      }

      const wallet = await prisma.wallet.upsert({
        where: { coachId: coach.id },
        update: {},
        create: { coachId: coach.id, balance: 500 }
      });

      if (wallet.balance < item.price) {
        await interaction.reply({
          content: `❌ Insufficient funds. You have DIC$ ${wallet.balance}.`,
          ephemeral: true
        });
        return;
      }

      await prisma.wallet.update({
        where: { coachId: coach.id },
        data: { balance: { decrement: item.price } }
      });

      await prisma.purchase.create({
        data: {
          coachId: coach.id,
          itemId: item.id,
          price: item.price,
          note
        }
      });

      await interaction.reply(`✅ Purchased **${item.name}** for **DIC$ ${item.price}**.`);
      return;
    }

    if (sub === 'add' || sub === 'remove') {
      // Admin check
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ content: 'Admin only.', ephemeral: true });
        return;
      }

      if (sub === 'add') {
        const id = interaction.options.getString('item_id', true);
        const name = interaction.options.getString('name', true);
        const price = interaction.options.getInteger('price', true);
        const description = interaction.options.getString('description', true);

        await prisma.item.upsert({
          where: { id },
          update: { name, price, description },
          create: { id, name, price, description }
        });

        await interaction.reply(`✅ Added/updated **${id}** — ${name} (DIC$ ${price}).`);
        return;
      }

      if (sub === 'remove') {
        const id = interaction.options.getString('item_id', true);
        try {
          await prisma.item.delete({ where: { id } });
          await interaction.reply(`🗑️ Removed **${id}** from the store.`);
        } catch {
          await interaction.reply({ content: '❌ Item not found.', ephemeral: true });
        }
        return;
      }
    }
  }
} as const;
