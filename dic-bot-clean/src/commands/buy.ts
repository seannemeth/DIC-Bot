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
import { PrismaClient, type Item } from '@prisma/client';
import { syncStoreFromSheet } from '../lib/storeSheet';

const prisma = new PrismaClient();

// 👉 flip this to true if you want /buy to auto-enable the first item it finds
const AUTO_ENABLE_IF_EMPTY = false;

export const command = {
  data: new SlashCommandBuilder()
    .setName('buy')
    .setDescription('Buy an item from the store'),

  async execute(interaction: ChatInputCommandInteraction) {
    // 1) Count what exists
    const [totalCount, enabledCount] = await Promise.all([
      prisma.item.count(),
      prisma.item.count({ where: { enabled: true } }),
    ]);

    // 2) If nothing enabled, try a one-shot sync (in case you just updated the sheet)
    if (enabledCount === 0) {
      try {
        const res = await syncStoreFromSheet();
        // re-count after sync
        const [total2, enabled2] = await Promise.all([
          prisma.item.count(),
          prisma.item.count({ where: { enabled: true } }),
        ]);

        if (enabled2 === 0) {
          const first = await prisma.item.findFirst({ orderBy: { id: 'asc' } });
          const diagLines = [
            `Total items in DB: ${total2}`,
            `Enabled items: ${enabled2}`,
            first
              ? `First item sample: id=${first.id} • itemKey=${first.itemKey} • name=${first.name} • price=${first.price} • enabled=${first.enabled} • type=${first.type}`
              : 'First item sample: (none)',
            `Last sync: upserts=${res.upserts}, skipped=${res.skipped}/${res.totalRows}`,
          ].join('\n');

          if (AUTO_ENABLE_IF_EMPTY && first) {
            await prisma.item.update({ where: { id: first.id }, data: { enabled: true } });
            return interaction.reply({
              content: `ℹ️ No enabled items. I auto-enabled **${first.name}**.\nRun /buy again.`,
              ephemeral: true,
            });
          }

          return interaction.reply({
            content:
              `❌ No enabled store items found.\n` +
              `• Make sure your **Store** sheet has an **enabled** column set to TRUE (or omit it; default is TRUE)\n` +
              `• Or enable an item directly in DB / sheet and /store_sync again.\n\n` +
              diagLines,
            ephemeral: true,
          });
        }
      } catch (e: any) {
        return interaction.reply({
          content:
            `❌ Could not sync the Store: ${e?.message || e}\n` +
            `Tip: Check GOOGLE_SHEETS_SPREADSHEET_ID and tab name (STORE_TAB_NAME).`,
          ephemeral: true,
        });
      }
    }

    // 3) Load enabled items
    const items: Item[] = await prisma.item.findMany({
      where: { enabled: true },
      orderBy: { name: 'asc' },
      take: 25, // Discord select menus max 25 options
    });

    if (!items.length) {
      const first = await prisma.item.findFirst({ orderBy: { id: 'asc' } });
      return interaction.reply({
        content:
          `❌ Still no enabled items to show.\n` +
          (first
            ? `First item sample: id=${first.id} • itemKey=${first.itemKey} • name=${first.name} • price=${first.price} • enabled=${first.enabled} • type=${first.type}`
            : 'First item sample: (none)'),
        ephemeral: true,
      });
    }

    // 4) Build the select menu
    const options = items.map((item: Item) =>
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

    const replyMsg = await interaction.reply({
      content: '🛒 Select the item you want to buy:',
      components: [row],
    });

    // 5) Await the user’s selection
    try {
      const selectInteraction = (await replyMsg.awaitMessageComponent({
        componentType: ComponentType.StringSelect,
        time: 30_000,
        filter: (i: StringSelectMenuInteraction) =>
          i.customId === 'buy_item' && i.user.id === interaction.user.id,
      })) as StringSelectMenuInteraction;

      const itemId = parseInt(selectInteraction.values[0], 10);
      const selectedItem = await prisma.item.findUnique({ where: { id: itemId } });

      if (!selectedItem || !selectedItem.enabled) {
        await selectInteraction.reply({
          content: '❌ Item not available.',
          ephemeral: true,
        });
        return;
      }

      // Preview/confirm
      const preview = new EmbedBuilder()
        .setTitle(`Confirm purchase`)
        .setDescription(
          `**${selectedItem.name}**\nPrice: **${selectedItem.price}** coins\n\n${selectedItem.description ?? ''}`
        )
        .setColor(0x2ecc71);

      await selectInteraction.reply({
        embeds: [preview],
        ephemeral: true,
      });

      // Optional: remove menu
      await replyMsg.edit({ components: [] }).catch(() => {});
    } catch {
      await replyMsg
        .edit({ content: '⏱️ No selection made.', components: [] })
        .catch(() => {});
    }
  },
} as const;
