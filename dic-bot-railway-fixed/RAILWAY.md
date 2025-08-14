# Deploying DIC Bot to Railway
1) Create a Railway project and add the **PostgreSQL** plugin. Copy `DATABASE_URL` into Variables.
2) Set Variables from `railway.env.template.json`.
3) First deploy: set Start Command to `pnpm cmds:deploy && node dist/index.js`, deploy once, then switch back to `node dist/index.js`.
