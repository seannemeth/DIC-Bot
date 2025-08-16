import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import { tickYouTube, tickTwitch } from '../ingest/attachLiveNotifier';

function isAdmin(i: ChatInputCommandInteraction) {
  return Boolean(i.memberPermissions?.has(PermissionFlagsBits.Administrator));
}

export const command = {
  data: new SlashCommandBuilder()
    .setName('livealerts_tick')
    .setDescription('Force a live alerts poll now (admin)')
    .addStringOption(o =>
      o
        .setName('platform')
        .setDescription('Only poll one platform (default: both)')
        .addChoices(
          { name: 'both', value: 'both' },
          { name: 'youtube', value: 'youtube' },
          { name: 'twitch', value: 'twitch' },
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!isAdmin(interaction)) {
      await interaction.reply({ content: '❌ Admin only.', flags: MessageFlags.Ephemeral });
      return;
    }

    const choice = (interaction.options.getString('platform') ?? 'both') as
      | 'both'
      | 'youtube'
      | 'twitch';

    await interaction.reply({
      content: `⏳ Running live poll${choice !== 'both' ? ` for **${choice}**` : ' for **both**'}…`,
      flags: MessageFlags.Ephemeral,
    });

    try {
      if (choice === 'youtube') {
        await tickYouTube(interaction.client);
      } else if (choice === 'twitch') {
        await tickTwitch(interaction.client);
      } else {
        await Promise.allSettled([tickYouTube(interaction.client), tickTwitch(interaction.client)]);
      }

      await interaction.followUp({
        content: `✅ Poll complete${choice !== 'both' ? ` (platform: **${choice}**)` : ''}. Check your alerts channel for any posts.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (e: any) {
      await interaction.followUp({
        content: `❌ Poll failed: ${e?.message || e}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },
} as const;
