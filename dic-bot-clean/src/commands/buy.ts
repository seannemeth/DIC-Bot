// src/commands/buy.ts
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ComponentType,
  type StringSelectMenuInteraction,
  EmbedBuilder,
} from 'discord.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const command = {
  data: new SlashCommandBuilder()
    .setName('buy')
    .setDescription('Buy an item from the store'),

  async execute(interaction: ChatInputCommandInteraction) {
    // Load items (enabled only)
    const items = await prisma.item.findMany({
      where: { enabled: true },
      orderBy: { name: 'asc' },
      take: 25, // Discord limit per select menu
    });

    if (!items.length) {
      await interaction.reply({
        content: '❌ No items available in the store.',
        ephemeral: true,
      });
      return;
    }

    // Build select options
    const options = items.map((item) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(item.name.length > 90 ? item.name.slice(0, 90) : item.name)
        .setDescription(
          `${item.price} coins` +
            (item.description ? ` — ${item.description.slice(0, 80)}` : '')
        )
        .setValue(item.id.toString())
    );

    const menu = new StringSelectMenuBuilder()
      .setCustomId('buy_item')
      .setPlaceholder('Select an item to purchase')
      .addOptions(options);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);

    // Send a normal (non-ephemeral) message so we can await the component on it
    const replyMsg = await interaction.reply({
      content: '🛒 Select the item you want to buy:',
      components: [row],
      // set ephemeral: false by omitting it; collectors need a real message
    });

    try {
      // Wait for the user's selection on this specific message
      const selectInteraction = (await replyMsg.awaitMessageComponent({
        componentType: ComponentType.StringSelect,
        time: 30_000,
        filter: (i: StringSelectMenuInteraction) =>
          i.customId === 'buy_item' && i.user.id === interaction.user.id,
      })) as StringSelectMenuInteraction;

      const itemId = parseInt(selectInteraction.values[0], 10);
      const item = await prisma.item.findUnique({ where: { id: itemId } });

      if (!item || !item.enabled) {
        await selectInteraction.reply({
          content: '❌ Item not available.',
          ephemeral: true,
        });
        return;
      }

      // Preview/confirm embed (you can replace with real purchase logic)
      const preview = new EmbedBuilder()
        .setTitle(`Confirm purchase`)
        .setDescription(
          `**${item.name}**\nPrice: **${item.price}** coins\n\n${
            item.description ?? ''
          }`
        )
        .setColor(0x2ecc71);

      await selectInteraction.reply({
        embeds: [preview],
        ephemeral: true,
      });

      // TODO:
      // - Identify the buyer's coach/wallet
      // - Check balance >= item.price
      // - Deduct, create Purchase row, apply effect
      // - Acknowledge success/failure

      // Optionally remove the menu after selection
      await replyMsg.edit({ components: [] }).catch(() => {});

    } catch {
      // Timed out—clean up components
      await replyMsg.edit({
        content: '⏱️ No selection made.',
        components: [],
      }).catch(() => {});
    }
  },
} as const;
