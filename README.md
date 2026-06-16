# World Cup 2026 AI Predictor

A clean, mobile-friendly web app that fetches upcoming **FIFA World Cup 2026**
fixtures, lets you pick a match, then produces an **AI prediction** — but only
after asking you a few clarifying questions first.

> ⚠️ Predictions are analytical estimates, **not betting advice and never
> guaranteed**.

---

## 1. Project overview

- **Frontend** — vanilla HTML / CSS / JavaScript, dashboard-style, responsive,
  no framework. Talks only to the local backend.
- **Backend** — Node.js + Express proxy. Keeps all API keys server-side, fetches
  + normalizes fixtures, caches them, and runs the question-first prediction
  flow.
- **Question-first behaviour** — selecting a match never predicts immediately.
  The assistant asks about prediction style, output depth, betting-style
  markets, what to weigh, and answer length. You answer in the UI, then it
  predicts.
- **Always works** — with **zero keys** it runs on clearly-labelled mock World
  Cup 2026 data and a local heuristic prediction engine.

### Features
Fetch upcoming fixtures · selectable list · filter by date / group / team /
status · selected-match card · AI clarifying questions · structured prediction
(winner, confidence, **1st-half + full-time** scores, reasoning, risk,
alternative scenario, data sources, missing data, disclaimer) · betting-style
markets incl. Over/Under 2.5, BTTS, Handicap and a dedicated **HT/FT double
result** · localStorage history · **re-run** button · **compare two styles**
(Safe vs Upset) · **auto-grading** of saved predictions (Correct/Wrong per market
+ accuracy scoreboard) once the real result is in · all times shown in **Malaysia
time (GMT+8)**.

---

## 2. How to install

Requires **Node.js 18+** (uses the built-in `fetch`).

```bash
cd world-cup-2026-ai-predictor
npm install
```

## 3. How to run

```bash
npm start        # production
npm run dev      # auto-reload (node --watch)
```

Then open <http://localhost:3000>.

With no `.env`, the app boots straight into **mock data + heuristic** mode so you
can click through the whole flow immediately.

## 3b. Deploy to Vercel (share with friends)

This repo includes `vercel.json` and `api/index.js` so the Express app runs as a
Vercel serverless function. The frontend and all `/api/*` routes are served by
the same function.

1. Push the repo to GitHub (keys stay out via `.gitignore`).
2. On [vercel.com](https://vercel.com) → **Add New → Project** → import the repo.
   Framework preset: **Other**. No build command needed.
3. **Project → Settings → Environment Variables** — add (do NOT commit these):
   `FOOTBALL_API_PROVIDER`, `FOOTBALL_API_KEY`, `AI_PROVIDER`, `AI_API_KEY`,
   `AI_MODEL`. (Same names as `.env`.)
4. **Deploy.** You get a public `https://<project>.vercel.app` URL to share.

> ⚠️ **Cost & limits when shared:** every visitor's prediction uses *your* AI
> key — set a spend limit in the Anthropic console and consider a private repo.
> Vercel functions are stateless, so the 15-minute in-memory fixture cache does
> **not** persist across cold starts; football-data.org is therefore called more
> often and may brush its 10-req/min free-tier limit (the app falls back to mock
> data if so). For heavier sharing, a persistent host (Render/Railway) keeps the
> cache warm.

## 4. How to configure API keys

```bash
cp .env.example .env
```

Edit `.env`:

```env
FOOTBALL_API_PROVIDER=auto        # auto | api-football | football-data | sportmonks | thesportsdb | mock
FOOTBALL_API_KEY=your_key_here
FOOTBALL_API_BASE_URL=            # optional override

AI_PROVIDER=anthropic             # anthropic | openai | mock
AI_API_KEY=your_ai_key_here
AI_MODEL=claude-opus-4-8
```

Keys live **only** on the server and are never sent to the browser. Restart the
server after editing `.env`.

## 5. How the data-source selection works

`server/dataSources/dataSourceSelector.js` is a decision module. It scores every
provider (0–3 each) across explicit criteria:

| Criterion | Meaning |
|---|---|
| `wc2026Fixtures` | actually carries World Cup 2026 fixtures |
| `upcoming` | supports upcoming/scheduled matches |
| `liveStatus` | live score / status |
| `teamStats` | standings / team stats for context |
| `freeTier` | usable free tier or trial |
| `docs` | documentation quality |
| `legal` | clearly allowed for this use |
| `stability` | production stability |
| `serverCallable` | callable from a backend |
| `predictionData` | richness of data for predictions |

In `auto` mode it ranks providers by total score, **drops keyed providers when
no key is present**, and tries them in order. **Mock data is always appended as
the final fallback**, so the app never breaks. Click **“Why this source?”** in
the UI to see the live ranking. Set `FOOTBALL_API_PROVIDER` to a specific id to
force one provider (mock still backs it up).

**Chosen default:** API-Football (API-Sports) when a key exists — best World Cup
coverage, fixtures + status + stats, free tier, strong docs. With no key it
falls to TheSportsDB (free shared key, no signup), then mock.

## 6. How the AI question-first prediction flow works

1. **Select a match** → backend builds a structured context
   (`/api/matches/:id/context`) from teams, group, kickoff, venue, form, goals,
   rest days, plus an explicit **`missingData`** list (odds, injuries, lineups…).
2. **Ask questions** (`POST /api/prediction/questions`) → the assistant returns
   clarifying questions; you answer them in the UI.
3. **Generate** (`POST /api/prediction/generate`) → the backend sends the
   context + your answers to the AI with a strict system prompt that forbids
   fabricating data and forces the exact prediction JSON schema. The frontend
   renders it nicely. Without an AI key, a deterministic local heuristic produces
   the same JSON shape, clearly labelled.

### Backend endpoints
- `GET /api/status` — provider, mode, decision plan, AI engine.
- `GET /api/matches/upcoming` — normalized fixtures (`?refresh=1` skips cache).
- `GET /api/matches/:id/context` — structured prediction context.
- `POST /api/prediction/questions` — clarifying questions.
- `POST /api/prediction/generate` — final prediction JSON.

Fixtures are cached in memory for **15 minutes**.

## 7. Limitations

- Mock data is **illustrative**, not the official schedule.
- Free football tiers may restrict future-tournament endpoints; the selector
  then falls through to mock.
- Real providers don’t expose detailed team stats in a single call here, so the
  prediction context honestly reports those as missing unless on mock data.
- No live odds / injuries / lineups wired in yet (listed in `missingData`).
- The local heuristic is a transparent baseline, not a trained model.

## 8. Future improvements

- Add an odds API (and feed it into the “odds market” focus)
- Add Elo ratings
- Add injury-news API
- Add lineup data
- Add xG data
- Add a Monte-Carlo simulation model
- Add a user prediction leaderboard
- Export predictions to CSV
- Telegram / WhatsApp sharing

---

## Project structure

```
world-cup-2026-ai-predictor/
├── public/                 # frontend (served statically)
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── server/
│   ├── server.js           # Express app + routes
│   ├── dataSources/
│   │   ├── dataSourceSelector.js
│   │   ├── apiFootballProvider.js
│   │   ├── footballDataProvider.js
│   │   ├── sportmonksProvider.js
│   │   ├── theSportsDbProvider.js
│   │   └── mockProvider.js
│   ├── prediction/
│   │   ├── buildMatchContext.js
│   │   ├── questionGenerator.js
│   │   ├── predictionGenerator.js
│   │   └── prompts.js
│   └── utils/
│       ├── cache.js
│       ├── date.js
│       └── normalize.js
├── .env.example
├── package.json
└── README.md
```
