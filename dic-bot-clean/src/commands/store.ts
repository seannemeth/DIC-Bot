import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction
} from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { refreshStoreFromSheet } from '../lib/storeSheet'; // keep if you want /store refresh

const prisma = new PrismaClient();

export const command = {
  data: new SlashCommandBuilder()
    .setName('store')
    .setDescription('Browse or manage the DIC store')
    .addSubcommand(sc =>
      sc.setName('list')
        .setDescription('List store items'),
    )
    .addSubcommand(sc =>
      sc.setName('buy')
        .setDescription('Buy a store item')
        .addStringOption(o =>
          o.setName('item')
            .setDescription('Item key (see /store list)')
            .setRequired(true),
        )
        .addIntegerOption(o =>
          o.setName('qty')
            .setDescription('Quantity (default 1)')
            .setMinValue(1),
        )
        .addStringOption(o =>
          o.setName('note')
            .setDescription('Optional note'),
        ),
    )
    .addSubcommand(sc =>
      sc.setName('refresh')
        .setDescription('Admin: refresh items from Google Sheet'),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();

    // /store list
    if (sub === 'list') {
      await interaction.deferReply({ ephemeral: true });

      const dbItems = await prisma.item.findMany({
        where: { enabled: true },
        orderBy: { price: 'asc' },
      });

      if (!dbItems.length) {
        return interaction.editReply('No store items available. (Run `/store refresh` if you just added them to the Sheet.)');
      }

      const lines = dbItems.map((i: any) =>
        `**${i.itemKey}** — ${i.name} • ${i.price} DIC$\n${i.description ?? ''}`.trim()
      );

      const embed = new EmbedBuilder()
        .setTitle('DIC Store')
        .setDescription(lines.join('\n\n'))
        .setColor(0xf1c40f);

      return interaction.editReply({ embeds: [embed] });
    }

    // /store buy
    if (sub === 'buy') {
      await interaction.deferReply({ ephemeral: true });

      const itemKey = interaction.options.getString('item', true).trim();
      const qty = interaction.options.getInteger('qty') ?? 1;
      const note = interaction.options.getString('note') ?? null;

      const coach = await prisma.coach.findUnique({
        where: { discordId: interaction.user.id },
      });
      if (!coach) {
        return interaction.editReply('❌ You must set up first with `/setteam`.');
      }

      const item = await prisma.item.findUnique({ where: { itemKey } });
      if (!item || !item.enabled) {
        return interaction.editReply('❌ Item not found or disabled. Use `/store list` to see available items.');
      }

      const wallet = await prisma.wallet.upsert({
        where: { coachId: coach.id },
        create: { coachId: coach.id, balance: 500 },
        update: {},
      });

      const cost = (item.price || 0) * qty;
      if (wallet.balance < cost) {
        return interaction.editReply(`❌ Not enough DIC$. Cost: ${cost}. Your balance: ${wallet.balance}.`);
      }

      // Charge
      await prisma.wallet.update({
        where: { coachId: coach.id },
        data: { balance: { decrement: cost } },
      });

      // Record purchase (qty-based)
      await prisma.purchase.create({
        data: {
          coachId: coach.id,
          itemId: item.id,
          qty,
          price: item.price,
          note,
        },
      });

      return interaction.editReply(`✅ Bought **${item.name}** x${qty} for **${cost} DIC$**.`);
    }

    // /store refresh (admin)
    if (sub === 'refresh') {
      // @ts-ignore simple admin check
      if (!interaction.memberPermissions?.has('Administrator')) {
        return interaction.reply({ content: 'Admin only.', ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      await refreshStoreFromSheet();
      const count = await prisma.item.count();
      return interaction.editReply(`✅ Store synced from Google Sheet. Items in DB: **${count}**.`);
    }
  },
} as const;
