import { SlashCommandBuilder, EmbedBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { refreshStoreFromSheet } from '../lib/storeSheet';
const prisma = new PrismaClient();

export const command = {
  data: new SlashCommandBuilder()
    .setName('store')
    .setDescription('Browse or manage the DIC store')
    .addSubcommand(sc => sc.setName('list').setDescription('Show available items'))
    .addSubcommand(sc => sc.setName('refresh').setDescription('Admin: refresh items from Google Sheet')),
  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'refresh') {
      // simple admin check
      // @ts-ignore
      if (!interaction.memberPermissions?.has('Administrator')) {
        return interaction.reply({ content: 'Admin only.', ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      await refreshStoreFromSheet();
      const count = await prisma.item.count();
      return interaction.editReply(`✅ Store synced. Items in DB: **${count}**.`);
    }

    // list
    await interaction.deferReply({ ephemeral: true });
    const items = await prisma.item.findMany({ where: { enabled: true }, orderBy: { price: 'asc' } });
    if (!items.length) return interaction.editReply('No items are enabled in the store.');

    const lines = items.map(i => `**${i.itemKey}** — ${i.name} • ${i.price} DIC$\n${i.description ?? ''}`.trim());
    const embed = new EmbedBuilder()
      .setTitle('DIC Store')
      .setDescription(lines.join('\n\n'))
      .setColor(0xf1c40f);
    return interaction.editReply({ embeds: [embed] });
  }
} as const;
