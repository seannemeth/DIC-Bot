// scripts/clearGuildCommands.ts
import 'dotenv/config';
import { REST, Routes } from 'discord.js';

async function main() {
  const token   = process.env.DISCORD_TOKEN;
  const clientId = process.env.CLIENT_ID; // your application (bot) ID
  const guildId  = process.env.GUILD_ID;  // the server ID you want to clear

  if (!token || !clientId || !guildId) {
    throw new Error('Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID env vars.');
  }

  const rest = new REST({ version: '10' }).setToken(token);

  // (Optional) show what’s currently registered
  const existing: any = await rest.get(
    Routes.applicationGuildCommands(clientId, guildId)
  );
  console.log(`Found ${existing.length} guild commands:`,
    existing.map((c: any) => `/${c.name}`).join(', ') || '(none)');

  // Clear ALL guild commands
  await rest.put(
    Routes.applicationGuildCommands(clientId, guildId),
    { body: [] }
  );

  console.log('✅ Cleared all guild commands for', guildId);
}

main().catch(err => {
  console.error('❌ Failed to clear guild commands:', err);
  process.exit(1);
});
