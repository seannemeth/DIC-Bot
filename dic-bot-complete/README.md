# DIC Bot (Railway-ready)

- Discord bot (slash commands: `/setteam`, `/standings`, `/leaderboard`)
- Web dashboard (standings + power rankings): serves from `/public`
- Prisma/Postgres storage

## Deploy on Railway
1. Push this repo to GitHub.
2. Railway → New Project → Deploy from GitHub.
3. Add **PostgreSQL** plugin; copy `DATABASE_URL` to service Variables.
4. Set Variables: `DISCORD_TOKEN`, `DISCORD_APP_ID`, `DISCORD_GUILD_ID`, `PORT=3000`, `DATABASE_URL`.
5. Deploy. First time, you may run: `pnpm cmds:deploy && node dist/index.js` as Start Command once, then switch back to `node dist/index.js`.

## Local Dev
```bash
pnpm i
cp .env.example .env   # create and fill DISCORD_* + DATABASE_URL
pnpm db:push
pnpm cmds:deploy
pnpm dev
```
