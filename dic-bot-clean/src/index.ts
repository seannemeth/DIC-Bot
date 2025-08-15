client.on('interactionCreate', async (interaction: Interaction) => {
  try {
    // --- Route postscore UI first (select -> modal, modal -> DB) ---
    if (interaction.isStringSelectMenu()) {
      // In ./commands/postscore.ts we exported handlePostScoreSelect
      if (typeof PostScore.handlePostScoreSelect === 'function') {
        await PostScore.handlePostScoreSelect(interaction);
        return; // handled
      }
    }

    if (interaction.isModalSubmit()) {
      // In ./commands/postscore.ts we exported handlePostScoreModal
      if (typeof PostScore.handlePostScoreModal === 'function') {
        await PostScore.handlePostScoreModal(interaction);
        return; // handled
      }
    }

    // --- Autocomplete support (unchanged) ---
    if (interaction.isAutocomplete()) {
      const cmd = commands.get(interaction.commandName);
      if (cmd?.autocomplete) {
        try {
          await cmd.autocomplete(interaction);
        } catch (e) {
          console.error('[AC ERROR]', e);
        }
      }
      return;
    }

    // --- Slash commands (chat input) ---
    if (!interaction.isChatInputCommand()) return;

    const cmd = commands.get(interaction.commandName);
    if (!cmd) {
      await interaction.reply({ content: 'Command not found.', ephemeral: true }).catch(() => {});
      return;
    }

    // Simple admin gate if a command marks itself adminOnly
    // @ts-ignore
    if (cmd.adminOnly && !('memberPermissions' in interaction && interaction.memberPermissions?.has('Administrator'))) {
      await interaction.reply({ content: 'Admin only.', ephemeral: true }).catch(() => {});
      return;
    }

    await cmd.execute(interaction);
  } catch (e) {
    console.error('[CMD/INTERACTION ERROR]', e);
    try {
      if ('isRepliable' in interaction && interaction.isRepliable()) {
        // Prefer followUp if already replied/deferred
        // @ts-ignore
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: 'Command error.', ephemeral: true });
        } else {
          await interaction.reply({ content: 'Command error.', ephemeral: true });
        }
      }
    } catch {}
  }
});
