# DIC Discord Bot — Scores, Standings, Betting, Google Sheets

## Commands
- `/setteam [team] [conference?]`
- `/postscore my: [pts] opp: [pts] opp_user: [@user] [week?] [season?]` (with Confirm/Dispute buttons)
- `/standings` overall W-L table
- `/leaderboard` top DIC$ balances
- `/bet` place bets using Google Sheet lines
- `/adminbank grant|reset|linessync` (admin only)

## Google Sheets
Create a spreadsheet with a **Lines** tab having headers:
`Season, Week, HomeTeam, AwayTeam, Spread, Total, HomeML, AwayML, CutoffUtc`

Share the sheet with your service account email (Editor).

Set env vars:
- `GOOGLE_SHEET_ID`
- `GOOGLE_CLIENT_EMAIL`
- `GOOGLE_PRIVATE_KEY` (use \n for line breaks)

## Deploy (Railway)
1. Push this folder to GitHub.
2. Create a Railway project → Deploy from GitHub.
3. Add PostgreSQL plugin; copy `DATABASE_URL` to Variables.
4. Variables to set:
   - `DISCORD_TOKEN`, `DISCORD_APP_ID`, `DISCORD_GUILD_ID`
   - `DATABASE_URL`
   - `GOOGLE_SHEET_ID`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`
5. First deploy: set Start Command to `pnpm cmds:deploy && node dist/index.js`, then switch back to `node dist/index.js`.

## Local Dev
```bash
pnpm i
cp .env.example .env
pnpm db:push
pnpm cmds:deploy
pnpm dev
```

## Notes
- Bets auto‑settle when a game is **confirmed**.
- Wallets: use `/adminbank reset` at season start and `/adminbank grant` to top up users.
