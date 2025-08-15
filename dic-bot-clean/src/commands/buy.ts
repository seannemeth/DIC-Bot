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
    // Load items from DB (show only enabled, ordered by name)
    const items = await prisma.item.findMany({
      where: { enabled: true },
      orderBy: { name: 'asc' },
      take: 25, // Discord select menus allow max 25 options
    });

    if (!items.length) {
      await interaction.reply({
        content: '❌ No items available in the store.',
        ephemeral: true,
      });
      return;
    }

    // Build options
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

    await interaction.reply({
      content: '🛒 Select the item you want to buy:',
      components: [row],
      ephemeral: true,
    });

    // Await exactly one selection on this interaction's original reply
    try {
      const selectInteraction: StringSelectMenuInteraction =
        (await interaction.awaitMessageComponent({
          componentType: ComponentType.StringSelect,
          time: 30_000,
          filter: (i) =>
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

      // TODO: Replace with your real wallet/coach lookup + balance check + purchase logic.
      // This is a placeholder "preview" so you can confirm selection UX first.
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

      // If you want immediate purchase flow, put it here:
      // 1) find coach by discord id (if you store it)
      // 2) check wallet >= item.price
      // 3) decrement wallet, create Purchase row, apply ITEM effect (if needed)
      // 4) reply with success or insufficient funds

    } catch {
      // timed out or aborted
      try {
        await interaction.editReply({
          content: '⏱️ No selection made.',
          components: [],
        });
      } catch {
        /* ignore */
      }
    }
  },
} as const;
