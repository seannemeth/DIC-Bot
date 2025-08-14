import express, { Request, Response } from 'express';
import cors from 'cors';
import { getStandings, getPowerRankings, getRecentGames, placeBet, getBets, adminResetSeason } from '../lib/api';

const app = express();
app.use(cors());
app.use(express.json());

// Standings route
app.get('/standings', async (_req: Request, res: Response) => {
  try {
    const standings = await getStandings();
    res.json(standings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch standings' });
  }
});

// Power rankings route
app.get('/power', async (_req: Request, res: Response) => {
  try {
    const rankings = await getPowerRankings();
    res.json(rankings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch power rankings' });
  }
});

// Recent games route
app.get('/recent', async (_req: Request, res: Response) => {
  try {
    const games = await getRecentGames();
    res.json(games);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch recent games' });
  }
});

// Bets routes
app.get('/bets', async (_req: Request, res: Response) => {
  try {
    const bets = await getBets();
    res.json(bets);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch bets' });
  }
});

app.post('/bets', async (req: Request, res: Response) => {
  try {
    const { userId, gameId, amount, betType } = req.body;
    const bet = await placeBet(userId, gameId, amount, betType);
    res.json(bet);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to place bet' });
  }
});

// Admin reset
app.post('/admin/reset', async (_req: Request, res: Response) => {
  try {
    await adminResetSeason();
    res.json({ message: 'Season reset successful' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reset season' });
  }
});

// Start server
export function startServer() {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Web dashboard API running on port ${PORT}`);
  });
}
