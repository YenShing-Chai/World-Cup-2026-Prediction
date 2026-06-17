/**
 * Monte Carlo match simulation.
 *
 * The AI estimates each team's expected goals (lambda) from the structured
 * match context; we then run N independent Poisson-distributed simulations of
 * the match and aggregate Win/Draw/Loss counts. Falls back to a heuristic
 * lambda estimate when no AI key is configured.
 */

import { SIM_SYSTEM_PROMPT, buildSimPrompt } from './prompts.js';

/** Sample a Poisson(lambda) random variable (Knuth's algorithm). */
function poissonSample(lambda) {
  const L = Math.exp(-Math.max(0, lambda));
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * Run the Monte Carlo simulation.
 * @returns {{runs:number, homeWin:number, draw:number, awayWin:number}}
 */
export function runMonteCarlo(lambdaHome, lambdaAway, runs = 100) {
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  for (let i = 0; i < runs; i++) {
    const h = poissonSample(lambdaHome);
    const a = poissonSample(lambdaAway);
    if (h > a) homeWin++;
    else if (h < a) awayWin++;
    else draw++;
  }
  return { runs, homeWin, draw, awayWin };
}

/** Heuristic expected-goals estimate from the structured context. */
function heuristicLambdas(ctx) {
  const h = ctx.teams?.home || {};
  const a = ctx.teams?.away || {};
  const base = 1.3;
  // Rank effect: lower FIFA rank number = stronger. Map to roughly -1..+1.
  const rankPull = (t) => (t.fifaRank ? (40 - Math.min(t.fifaRank, 80)) / 40 : 0);
  let lh = base + rankPull(h) * 0.5 - rankPull(a) * 0.3 + 0.15; // small home edge
  let la = base + rankPull(a) * 0.5 - rankPull(h) * 0.3;
  // Goals scored/conceded nudge, when available.
  if (h.goalsFor != null && a.goalsAgainst != null) lh += (h.goalsFor - a.goalsAgainst) * 0.04;
  if (a.goalsFor != null && h.goalsAgainst != null) la += (a.goalsFor - h.goalsAgainst) * 0.04;
  return { home: clamp(lh, 0.3, 3.4), away: clamp(la, 0.3, 3.4) };
}

/** Tolerant JSON parse. */
function parseJsonLoose(text) {
  if (!text) throw new Error('Empty AI response');
  let t = text.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(t);
  } catch {
    const s = t.indexOf('{');
    const e = t.lastIndexOf('}');
    if (s !== -1 && e !== -1) return JSON.parse(t.slice(s, e + 1));
    throw new Error('Could not parse AI JSON');
  }
}

async function aiLambdasAnthropic(ctx, ai) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ai.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ai.model || 'claude-opus-4-8',
      max_tokens: 300,
      system: SIM_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildSimPrompt(ctx) }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = (data.content || []).map((c) => c.text || '').join('');
  return parseJsonLoose(text);
}

async function aiLambdasOpenAI(ctx, ai) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ai.apiKey}` },
    body: JSON.stringify({
      model: ai.model || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SIM_SYSTEM_PROMPT },
        { role: 'user', content: buildSimPrompt(ctx) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return parseJsonLoose(data.choices?.[0]?.message?.content || '');
}

/** Resolve expected goals, preferring the AI, falling back to heuristic. */
async function getExpectedGoals(ctx, ai) {
  if (ai?.apiKey && (ai.provider === 'anthropic' || ai.provider === 'openai')) {
    try {
      const raw = ai.provider === 'anthropic' ? await aiLambdasAnthropic(ctx, ai) : await aiLambdasOpenAI(ctx, ai);
      const home = clamp(Number(raw?.expectedGoals?.home), 0.1, 5);
      const away = clamp(Number(raw?.expectedGoals?.away), 0.1, 5);
      if (Number.isFinite(home) && Number.isFinite(away)) {
        return { home, away, source: 'ai', rationale: raw?.rationale || '' };
      }
    } catch {
      // fall through to heuristic
    }
  }
  return { ...heuristicLambdas(ctx), source: 'heuristic', rationale: 'Estimated from rankings, form and goal difference.' };
}

/**
 * Public entry: estimate expected goals then run the simulation.
 * @param {{matchContext:object, ai:object, runs?:number}} args
 */
export async function simulate({ matchContext, ai, runs = 100 }) {
  const eg = await getExpectedGoals(matchContext, ai);
  const tally = runMonteCarlo(eg.home, eg.away, runs);
  const pct = (n) => Math.round((n / tally.runs) * 100);
  return {
    runs: tally.runs,
    expectedGoals: { home: Number(eg.home.toFixed(2)), away: Number(eg.away.toFixed(2)) },
    source: eg.source,
    rationale: eg.rationale,
    homeWin: tally.homeWin,
    draw: tally.draw,
    awayWin: tally.awayWin,
    homeWinPct: pct(tally.homeWin),
    drawPct: pct(tally.draw),
    awayWinPct: pct(tally.awayWin),
  };
}

export default { simulate, runMonteCarlo };
