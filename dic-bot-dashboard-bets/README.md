# DIC Discord Bot (EA College Football Online Dynasty)

**Dynasty Intercollegiate Conference (DIC)** bot for scores, standings, head-to-head, AI recaps/previews/roasts, and banter learning (opt-in).

## Features
- `/postscore` with confirm/dispute buttons; free-text score parsing in #scores
- `/standings`, `/h2h`, `/schedule`, `/record`
- AI `/recap`, `/preview`, `/roastme` with PG → R spice levels and guardrails
- Banter learning (opt-in) → inside jokes in previews/recaps/roasts
- Admin: `/admin advance`, `/admin setresult`, `/admin toggle roast`, `/admin config set`
- Nightly cron: reminders & newsletter skeleton

## Quick Start
1) **Install**
```bash
pnpm i
cp .env.example .env
# Fill in env vars
```

2) **Database**
```bash
pnpm db:push
pnpm db:studio
```

3) **Register commands**
```bash
pnpm cmds:deploy
```

4) **Run**
```bash
pnpm dev
```

### Tech
- Node + TypeScript + discord.js v14
- Prisma + Postgres (JSON for embeddings; simple cosine in app)
- OpenAI for text generation (model via `OPENAI_MODEL`)

> NOTE: This starter avoids pgvector for simplicity. For larger banter corpora, swap to pgvector and cosine in SQL.

## Safety & Spice
- `DIC_SPICE_LEVEL=pg|pg13|r` — R allows adult innuendo and competitive smack talk but still **blocks slurs/identity-based harassment**.
- Coaches can `/learn opt-out` at any time; admins can purge lore per-user.

