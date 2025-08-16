// src/commands/commands_admin.ts
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';

export const command = {
  adminOnly: true, // works with your index.ts admin gate
  data: new SlashCommandBuilder()
    .setName('commands_admin')
    .setDescription('Admin: manage guild slash commands')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sc =>
      sc
        .setName('list')
        .setDescription('List all commands registered in this server'),
    )
    .addSubcommand(sc =>
      sc
        .setName('remove')
        .setDescription('Remove a command (by name) from this server')
        .addStringOption(o =>
          o
            .setName('name')
            .setDescription('The command name to remove (e.g., "postscore")')
            .setRequired(true),
        ),
    )
    .addSubcommand(sc =>
      sc
        .setName('remove_id')
        .setDescription('Remove a command (by id) from this server')
        .addStringOption(o =>
          o
            .setName('id')
            .setDescription('The command id to remove')
            .setRequired(true),
        ),
    )
    .addSubcommand(sc =>
      sc
        .setName('clear_all')
        .setDescription('Remove ALL commands from this server (dangerous)')
        .addStringOption(o =>
          o
            .setName('confirm')
            .setDescription('Type: I UNDERSTAND')
            .setRequired(true),
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    // Use flags to avoid the ephemeral deprecation warning
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.guild) {
      await interaction.editReply('❌ This can only be used in a server.');
      return;
    }

    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    try {
      if (sub === 'list') {
        const cmds = await guild.commands.fetch();
        if (!cmds.size) {
          await interaction.editReply('No guild commands registered.');
          return;
        }
        const lines = cmds
          .map(c => `• **/${c.name}** — id: \`${c.id}\``)
          .join('\n');
        await interaction.editReply(`Guild commands (${cmds.size}):\n${lines}`);
        return;
      }

      if (sub === 'remove') {
        const name = interaction.options.getString('name', true).trim().toLowerCase();
        const cmds = await guild.commands.fetch();
        const found = cmds.find(c => c.name.toLowerCase() === name);

        if (!found) {
          await interaction.editReply(`❌ Command "/${name}" not found in this server.`);
          return;
        }

        await guild.commands.delete(found.id);
        await interaction.editReply(`✅ Removed "/${found.name}" (id: \`${found.id}\`) from this server.`);
        return;
      }

      if (sub === 'remove_id') {
        const id = interaction.options.getString('id', true).trim();
        const cmds = await guild.commands.fetch();
        const found = cmds.get(id);

        if (!found) {
          await interaction.editReply(`❌ No guild command with id \`${id}\` found.`);
          return;
        }

        await guild.commands.delete(id);
        await interaction.editReply(`✅ Removed "/${found.name}" (id: \`${id}\`) from this server.`);
        return;
      }

      if (sub === 'clear_all') {
        const confirm = interaction.options.getString('confirm', true).trim();
        if (confirm !== 'I UNDERSTAND') {
          await interaction.editReply('❌ You must type exactly **I UNDERSTAND** to confirm.');
          return;
        }

        const before = await guild.commands.fetch();
        if (!before.size) {
          await interaction.editReply('No guild commands to remove.');
          return;
        }

        // Bulk clear by setting an empty array (supported in REST), but here we’ll delete one by one for clarity
        const ids = [...before.keys()];
        let ok = 0;
        for (const id of ids) {
          try {
            await guild.commands.delete(id);
            ok++;
          } catch {
            // ignore individual failures
          }
        }
        await interaction.editReply(`✅ Cleared ${ok}/${before.size} guild commands.`);
        return;
      }

      await interaction.editReply('Unknown subcommand.');
    } catch (e: any) {
      console.error('[commands_admin] error', e);
      await interaction.editReply(`❌ Error: ${e?.message || e}`);
    }
  },
} as const;
