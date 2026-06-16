// One-off helper: print HT + FT predictions for a few upcoming matches.
// Usage: node scripts/sample-predictions.mjs [count]
const BASE = 'http://localhost:3000';
const COUNT = Number(process.argv[2] || 5);

const get = (p) => fetch(BASE + p).then((r) => r.json());
const post = (p, body) =>
  fetch(BASE + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

const leadLabel = (ht, p) =>
  ht.result === 'home_lead' ? p.match.homeTeam
  : ht.result === 'away_lead' ? p.match.awayTeam
  : 'Level';

const data = await get('/api/matches/upcoming');
console.log(`Provider: ${data.activeProvider}  |  mock: ${data.isMock}\n`);

const upcoming = data.matches.filter((m) => m.status === 'scheduled').slice(0, COUNT);

for (const m of upcoming) {
  const res = await post('/api/prediction/generate', {
    matchId: m.id,
    answers: {
      predictionStyle: 'balanced',
      outputDepth: 'result-and-score',
      markets: ['Over/Under 2.5', 'Both Teams To Score'],
      focus: 'current tournament form',
      detail: 'short',
    },
  });
  if (res.error) {
    console.log(`• ${m.homeTeam} vs ${m.awayTeam} — ERROR: ${res.error}\n`);
    continue;
  }
  const p = res.prediction;
  const ht = p.prediction.halfTime;
  console.log(`• ${p.match.homeTeam} vs ${p.match.awayTeam}  [${p.match.group}]  (${res.engine})`);
  console.log(`    1st Half:  ${leadLabel(ht, p)}   ${ht.score}`);
  console.log(`    Full Time: ${p.prediction.winner}   ${p.prediction.predictedScore}   ${p.prediction.confidence}% · ${p.prediction.riskLevel} risk`);
  console.log(`    O/U 2.5:   ${p.bettingStyleInsights.overUnder25}`);
  console.log(`    BTTS:      ${p.bettingStyleInsights.bothTeamsToScore}\n`);
}
