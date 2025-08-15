import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { openSheetByTitle } from '../lib/googleAuth';
const prisma = new PrismaClient();

export const command = {
  data: new SlashCommandBuilder()
    .setName('redeem')
    .setDescription('Redeem an attribute item')
    .addStringOption(o => o.setName('item_id').setDescription('ItemId (ATTR type)').setRequired(true))
    .addStringOption(o => o.setName('attribute').setDescription('Which attribute (e.g., SPD, THP, TAK)').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Override amount (defaults from item payload)').setRequired(false))
    .addIntegerOption(o => o.setName('season').setDescription('Season number').setRequired(true))
    .addIntegerOption(o => o.setName('week').setDescription('Week number').setRequired(false))
    .addStringOption(o => o.setName('note').setDescription('Optional note').setRequired(false)),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const itemKey = interaction.options.getString('item_id', true).trim();
    const attribute = interaction.options.getString('attribute', true).trim().toUpperCase();
    const amountOverride = interaction.options.getInteger('amount') ?? undefined;
    const season = interaction.options.getInteger('season', true);
    const week = interaction.options.getInteger('week') ?? undefined;
    const note = interaction.options.getString('note') ?? undefined;

    const coach = await prisma.coach.findUnique({ where: { discordId: interaction.user.id } });
    if (!coach) return interaction.editReply('❌ You must set up first with `/setteam`.');

    const item = await prisma.item.findUnique({ where: { itemKey } });
    if (!item || item.type !== 'ATTR') return interaction.editReply('❌ Item must be an ATTR type.');

    // find an unconsumed purchase
    const purchase = await prisma.purchase.findFirst({
      where: { coachId: coach.id, itemId: item.id, consumed: { lt: prisma.purchase.fields.qty } }, // ts hint; real condition below
    });
    // Prisma trick: since the above line is awkward, do a simpler select:
    const all = await prisma.purchase.findMany({ where: { coachId: coach.id, itemId: item.id } });
    const usable = all.find(p => p.consumed < p.qty);
    if (!usable) return interaction.editReply('❌ You do not have any unused copies of that item.');

    const defAmount = Number((item.payload as any)?.amount ?? 0);
    const amt = amountOverride ?? defAmount;
    if (!amt || amt <= 0) return interaction.editReply('❌ Amount is missing. Set item payload amount or pass /redeem amount.');

    // Record upgrade in DB
    await prisma.upgrade.create({
      data: {
        coachId: coach.id,
        attribute,
        amount: amt,
        season,
        week: week ?? undefined,
        note: note ?? undefined,
      },
    });

    // Mark 1 unit consumed
    await prisma.purchase.update({
      where: { id: usable.id },
      data: { consumed: { increment: 1 } },
    });

    // Write to Upgrades sheet
    try {
      const sheetId = process.env.GOOGLE_SHEET_ID || '';
      const tab = await openSheetByTitle(sheetId, 'Upgrades');
      await tab.addRow({
        TimestampUTC: new Date().toISOString(),
        DiscordId: interaction.user.id,
        CoachId: coach.id,
        Handle: coach.handle,
        Team: coach.team ?? '',
        Attribute: attribute,
        Amount: amt,
        Season: season,
        Week: week ?? '',
        Note: note ?? '',
      });
    } catch (e) {
      // non-fatal
      console.error('[Upgrades sheet] write failed:', e);
    }

    return interaction.editReply(`✅ Redeemed **${item.name}**: +${amt} **${attribute}** recorded for Season ${season}${week ? `, Week ${week}` : ''}.`);
  }
} as const;
