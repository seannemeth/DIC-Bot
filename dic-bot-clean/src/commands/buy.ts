// src/commands/buy.ts
import { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ComponentType } from 'discord.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const command = {
  data: new SlashCommandBuilder()
    .setName('buy')
    .setDescription('Buy an item from the store'),
  
  async execute(interaction) {
    // Fetch store items from DB
    const items = await prisma.item.findMany({ orderBy: { name: 'asc' } });

    if (!items.length) {
      await interaction.reply({ content: '❌ No items available in the store.', ephemeral: true });
      return;
    }

    // Build select menu options
    const options = items.map(item =>
      new StringSelectMenuOptionBuilder()
        .setLabel(`${item.name} (${item.price} coins)`)
        .setValue(item.id.toString())
    );

    const menu = new StringSelectMenuBuilder()
      .setCustomId('buy_item')
      .setPlaceholder('Select an item to purchase')
      .addOptions(options);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);

    await interaction.reply({
      content: '🛒 Select the item you want to buy:',
      components: [row],
      ephemeral: true
    });

    // Wait for selection
    const collector = interaction.channel?.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 30_000,
      filter: i => i.customId === 'buy_item' && i.user.id === interaction.user.id
    });

    collector?.on('collect', async selectInteraction => {
      const itemId = parseInt(selectInteraction.values[0], 10);
      const item = await prisma.item.findUnique({ where: { id: itemId } });

      if (!item) {
        await selectInteraction.reply({ content: '❌ Item not found.', ephemeral: true });
        return;
      }

      // TODO: Deduct coins and add item to user inventory
      await selectInteraction.reply({ content: `✅ You bought **${item.name}** for ${item.price} coins!`, ephemeral: true });
    });
  }
};
