// src/commands/redeem.ts
import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export const command = {
  data: new SlashCommandBuilder()
    .setName('redeem')
    .setDescription('Redeem an attribute item from your inventory')
    .addStringOption(o =>
      o.setName('item_id')
        .setDescription('Store ItemId (e.g., ATTR-BOOST-5). Use /store list to see keys.')
        .setRequired(true),
    )
    .addStringOption(o =>
      o.setName('attribute')
        .setDescription('Attribute code (e.g., SPD, THP, TAK)')
        .setRequired(true),
    )
    .addIntegerOption(o =>
      o.setName('amount')
        .setDescription('Override amount (defaults to item payload amount)')
        .setRequired(false),
    )
    .addIntegerOption(o =>
      o.setName('season')
        .setDescription('Season')
        .setRequired(true),
    )
    .addIntegerOption(o =>
      o.setName('week')
        .setDescription('Week')
        .setRequired(false),
    )
    .addStringOption(o =>
      o.setName('note')
        .setDescription('Optional note')
        .setRequired(false),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const coach = await prisma.coach.findUnique({ where: { discordId: interaction.user.id } });
    if (!coach) {
      return interaction.editReply('❌ You must set up first with `/setteam`.');
    }

    const itemKey = interaction.options.getString('item_id', true).trim();
    const attribute = interaction.options.getString('attribute', true).trim().toUpperCase();
    const amountOverride = interaction.options.getInteger('amount') ?? undefined;
    const season = interaction.options.getInteger('season', true);
    const week = interaction.options.getInteger('week') ?? undefined;
    const note = interaction.options.getString('note') ?? undefined;

    // Find the item by human key, then use its numeric ID
    const item = await prisma.item.findUnique({ where: { itemKey } });
    if (!item) return interaction.editReply('❌ Item not found.');
    if (item.type !== 'ATTR') return interaction.editReply('❌ Only ATTR items can be redeemed with this command.');

    // Find a purchase with remaining quantity (consumed < qty)
    const purchases = await prisma.purchase.findMany({
      where: { coachId: coach.id, itemId: item.id },
      orderBy: { purchasedAt: 'asc' },
    });

    let usable: (typeof purchases)[number] | null = null;
    for (const p of purchases) {
      if (p.consumed < p.qty) { usable = p; break; }
    }
    if (!usable) return interaction.editReply('❌ You do not have any unused copies of that item.');

    // Determine amount from override or item payload
    const defaultAmt = Number((item.payload as Record<string, unknown> | null)?.['amount'] ?? 0);
    const amt = amountOverride ?? defaultAmt;
    if (!amt || amt <= 0) {
      return interaction.editReply('❌ Missing amount. Set item payload amount in the Store sheet or pass `/redeem amount:`.');
    }

    // Record the upgrade
    await prisma.upgrade.create({
      data: {
        coachId: coach.id,
        attribute,
        amount: amt,
        season,
        week: week ?? undefined,
      },
    });

    // Consume one unit
    await prisma.purchase.update({
      where: { id: usable.id },
      data: { consumed: { increment: 1 } },
    });

    return interaction.editReply(
      `✅ Redeemed **${item.name}**: +${amt} **${attribute}** recorded for Season ${season}${week ? `, Week ${week}` : ''}.`
    );
  },
} as const;
