import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { syncStoreFromSheet } from '../lib/storeSheet';

const prisma = new PrismaClient();

export const command = {
  data: new SlashCommandBuilder()
    .setName('store_sync')
    .setDescription('Sync store items from Google Sheet into the database'),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });
    try {
      const res = await syncStoreFromSheet();
      const count = await prisma.item.count();
      await interaction.editReply(
        `✅ Store synced. Upserts: ${res.upserts}, skipped: ${res.skipped}/${res.totalRows}. Items in DB: ${count}.\n${res.diag}`
      );
    } catch (e: any) {
      await interaction.editReply(`❌ Store sync failed: ${e?.message || e}`);
    }
  },
} as const;
