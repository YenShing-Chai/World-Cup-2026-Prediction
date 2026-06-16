/**
 * Prediction generator.
 *
 * Calls the configured AI provider (Anthropic or OpenAI) with the structured
 * context. If no AI key is present, falls back to a deterministic local
 * heuristic so the app still produces a coherent, clearly-labelled prediction.
 */

import { SYSTEM_PROMPT, buildUserPrompt } from './prompts.js';

/**
 * @param {object} args
 * @param {object} args.matchContext
 * @param {object} args.answers
 * @param {string} args.activeProvider - football data provider id
 * @param {object} args.ai - { provider, apiKey, model }
 * @returns {Promise<{prediction:object, engine:string}>}
 */
export async function generatePrediction({ matchContext, answers, activeProvider, ai }) {
  const hasKey = Boolean(ai?.apiKey);

  if (hasKey && ai.provider === 'anthropic') {
    const raw = await callAnthropic(matchContext, answers, activeProvider, ai);
    return { prediction: finalize(raw, matchContext, answers, activeProvider, false), engine: `anthropic:${ai.model}` };
  }
  if (hasKey && ai.provider === 'openai') {
    const raw = await callOpenAI(matchContext, answers, activeProvider, ai);
    return { prediction: finalize(raw, matchContext, answers, activeProvider, false), engine: `openai:${ai.model}` };
  }

  // No key -> heuristic.
  const raw = heuristicPrediction(matchContext, answers, activeProvider);
  return { prediction: finalize(raw, matchContext, answers, activeProvider, true), engine: 'local-heuristic' };
}

/* ------------------------------------------------------------------ */
/* AI provider calls                                                  */
/* ------------------------------------------------------------------ */

async function callAnthropic(matchContext, answers, activeProvider, ai) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ai.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ai.model || 'claude-opus-4-8',
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: buildUserPrompt(matchContext, answers, activeProvider) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = (data.content || []).map((c) => c.text || '').join('');
  return parseJsonLoose(text);
}

async function callOpenAI(matchContext, answers, activeProvider, ai) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${ai.apiKey}`,
    },
    body: JSON.stringify({
      model: ai.model || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(matchContext, answers, activeProvider) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  return parseJsonLoose(text);
}

/** Tolerant JSON parse: strips code fences and grabs the outermost object. */
function parseJsonLoose(text) {
  if (!text) throw new Error('Empty AI response');
  let t = text.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(t);
  } catch {
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start !== -1 && end !== -1) return JSON.parse(t.slice(start, end + 1));
    throw new Error('Could not parse AI JSON response');
  }
}

/* ------------------------------------------------------------------ */
/* Local heuristic (no-key fallback)                                  */
/* ------------------------------------------------------------------ */

function heuristicPrediction(ctx, answers, activeProvider) {
  const home = ctx.teams.home;
  const away = ctx.teams.away;
  const style = answers.predictionStyle || 'balanced';

  // Strength score from rank + form + goal diff (lower rank number = better).
  const score = (t) => {
    let s = 50;
    if (t.fifaRank) s += (50 - Math.min(t.fifaRank, 80)) * 0.6;
    if (t.goalsFor != null && t.goalsAgainst != null) s += (t.goalsFor - t.goalsAgainst) * 3;
    if (t.recentForm) s += (t.recentForm.match(/W/g) || []).length * 2;
    return s;
  };
  let hs = score(home) + 4; // small home/first-named edge
  let as = score(away);

  // Style adjusts how much we trust the favourite.
  let diff = hs - as;
  if (style === 'safe') diff *= 1.35;
  if (style === 'high-risk') diff *= 0.55;

  let resultType, winner, confidence;
  if (Math.abs(diff) < 4) {
    resultType = 'draw';
    winner = 'Draw';
    confidence = 38;
  } else if (diff > 0) {
    resultType = 'home_win';
    winner = home.name;
    confidence = clamp(50 + diff, 40, style === 'safe' ? 82 : 72);
  } else {
    resultType = 'away_win';
    winner = away.name;
    confidence = clamp(50 - diff, 40, style === 'safe' ? 80 : 70);
  }

  const goalsExpected =
    ((home.goalsFor ?? 1) + (away.goalsFor ?? 1) + (home.goalsAgainst ?? 1) + (away.goalsAgainst ?? 1)) / 4;
  const predictedScore =
    resultType === 'draw'
      ? '1-1'
      : resultType === 'home_win'
      ? '2-1'
      : '1-2';

  // Half-time tends to be lower-scoring and more often level. A clear favourite
  // (large |diff|) is more likely to already lead at the break.
  let halfTime;
  if (Math.abs(diff) >= 12) {
    halfTime =
      resultType === 'home_win'
        ? { result: 'home_lead', score: '1-0' }
        : resultType === 'away_win'
        ? { result: 'away_lead', score: '0-1' }
        : { result: 'draw', score: '0-0' };
  } else {
    halfTime = { result: 'draw', score: '0-0' };
  }
  halfTime.note =
    halfTime.result === 'draw'
      ? 'Expect a cagey, level first half before the game opens up.'
      : `${winner} projected to take an early lead but not put it away before the break.`;

  // Half-Time/Full-Time double result (from the home team's perspective).
  const htCode = halfTime.result === 'home_lead' ? 'Home' : halfTime.result === 'away_lead' ? 'Away' : 'Draw';
  const ftCode = resultType === 'home_win' ? 'Home' : resultType === 'away_win' ? 'Away' : 'Draw';
  const htftPick = `${htCode}/${ftCode}`;
  // Probability of the exact HT/FT combo is always lower than the FT confidence
  // alone (you must also be right about the break), so we discount it.
  const htftProb = clamp(Math.round(confidence * (htCode === ftCode ? 0.62 : 0.48)), 12, 70);
  // Most likely alternative: the "level at the break then wins" line.
  const altPick = ftCode === 'Draw' ? `${ftCode}/${ftCode}` : `Draw/${ftCode}`;
  const htft = {
    pick: htftPick,
    probability: htftProb,
    alternatives: [...new Set([altPick, htftPick === `Draw/${ftCode}` ? `${ftCode}/${ftCode}` : `Draw/${ftCode}`])]
      .filter((a) => a !== htftPick)
      .slice(0, 2),
    note:
      htCode === 'Draw' && ftCode !== 'Draw'
        ? `"${htftPick}" (level at half-time, ${ftCode === 'Home' ? home.name : away.name} win) is among the most common HT/FT outcomes.`
        : htCode === ftCode && ftCode !== 'Draw'
        ? `Backs ${(ftCode === 'Home' ? home.name : away.name)} to lead at the break and hold on — a lower-probability "lead-and-hold" line.`
        : 'A draw at the break is the safer second leg if you are unsure.',
  };

  const riskLevel = style === 'high-risk' ? 'high' : Math.abs(diff) < 8 ? 'medium' : 'low';

  return {
    match: {
      homeTeam: ctx.match.homeTeam,
      awayTeam: ctx.match.awayTeam,
      kickoff: ctx.match.kickoffLocal || ctx.match.kickoffUtc || '',
      group: ctx.match.group,
    },
    userPreference: {
      predictionStyle: style,
      marketsRequested: answers.markets || [],
    },
    prediction: {
      winner,
      resultType,
      confidence: Math.round(confidence),
      halfTime,
      predictedScore,
      riskLevel,
      alternativeScenario:
        resultType === 'draw'
          ? `${home.name} edges it 2-1 if they convert early chances.`
          : `A tight 1-1 draw is plausible if ${winner} start slowly.`,
      htft,
    },
    bettingStyleInsights: marketInsights(answers, goalsExpected),
    reasoning: [
      `${home.name} strength index ${Math.round(hs)} vs ${away.name} ${Math.round(as)} (rank + form + goal diff).`,
      `Prediction style "${style}" ${style === 'safe' ? 'amplified' : style === 'high-risk' ? 'dampened' : 'kept'} the favourite's edge.`,
      `Expected combined goals ≈ ${goalsExpected.toFixed(1)} drove the score and Over/Under view.`,
    ],
    dataSourcesUsed: [activeProvider === 'mock' ? 'Mock dataset (illustrative)' : activeProvider],
    missingData: ctx.missingData,
    disclaimer: 'This is an AI prediction (local heuristic, no live model), not a guaranteed result.',
  };
}

function marketInsights(answers, goalsExpected) {
  const wanted = new Set(answers.markets || []);
  const has = (m) => wanted.size === 0 || wanted.has(m);
  return {
    overUnder25: has('Over/Under 2.5')
      ? goalsExpected >= 2.5
        ? `Lean OVER 2.5 (expected ≈ ${goalsExpected.toFixed(1)} goals).`
        : `Lean UNDER 2.5 (expected ≈ ${goalsExpected.toFixed(1)} goals).`
      : 'Not requested',
    bothTeamsToScore: has('Both Teams To Score')
      ? goalsExpected >= 2.2
        ? 'BTTS leans YES — both attacks have been scoring.'
        : 'BTTS leans NO — at least one side looks likely to be shut out.'
      : 'Not requested',
    handicapView: has('Handicap')
      ? 'Favourite -1 is aggressive; the draw-no-bet / -0.5 line is the safer read.'
      : 'Not requested',
  };
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

const HTFT_CODES = [
  'Home/Home', 'Home/Draw', 'Home/Away',
  'Draw/Home', 'Draw/Draw', 'Draw/Away',
  'Away/Home', 'Away/Draw', 'Away/Away',
];

/** Validate/repair the HT/FT object so the pick is always one of the 9 codes. */
function normalizeHtft(htft, ctx) {
  const valid = (c) => HTFT_CODES.includes(c);
  const pick = htft && valid(htft.pick) ? htft.pick : 'Draw/Draw';
  const alternatives = Array.isArray(htft?.alternatives)
    ? htft.alternatives.filter((a) => valid(a) && a !== pick).slice(0, 2)
    : [];
  return {
    pick,
    probability: clamp(Number(htft?.probability ?? 25), 0, 100),
    alternatives,
    note: htft?.note || '',
  };
}

/* ------------------------------------------------------------------ */
/* Finalisation: guarantee schema completeness                        */
/* ------------------------------------------------------------------ */

function finalize(raw, ctx, answers, activeProvider, isHeuristic) {
  const safe = raw && typeof raw === 'object' ? raw : {};
  return {
    match: {
      homeTeam: safe.match?.homeTeam || ctx.match.homeTeam,
      awayTeam: safe.match?.awayTeam || ctx.match.awayTeam,
      kickoff: safe.match?.kickoff || ctx.match.kickoffLocal || ctx.match.kickoffUtc || '',
      group: safe.match?.group || ctx.match.group,
    },
    userPreference: {
      predictionStyle: safe.userPreference?.predictionStyle || answers.predictionStyle || 'balanced',
      marketsRequested: safe.userPreference?.marketsRequested || answers.markets || [],
    },
    prediction: {
      winner: safe.prediction?.winner ?? 'Unknown',
      resultType: safe.prediction?.resultType ?? 'draw',
      confidence: clamp(Number(safe.prediction?.confidence ?? 50), 0, 100),
      halfTime: {
        result: safe.prediction?.halfTime?.result ?? 'draw',
        score: safe.prediction?.halfTime?.score ?? '0-0',
        note: safe.prediction?.halfTime?.note ?? '',
      },
      predictedScore: safe.prediction?.predictedScore ?? 'N/A',
      riskLevel: safe.prediction?.riskLevel ?? 'medium',
      alternativeScenario: safe.prediction?.alternativeScenario ?? 'No alternative provided.',
      htft: normalizeHtft(safe.prediction?.htft, ctx),
    },
    bettingStyleInsights: {
      overUnder25: safe.bettingStyleInsights?.overUnder25 ?? 'Not requested',
      bothTeamsToScore: safe.bettingStyleInsights?.bothTeamsToScore ?? 'Not requested',
      handicapView: safe.bettingStyleInsights?.handicapView ?? 'Not requested',
    },
    reasoning: Array.isArray(safe.reasoning) && safe.reasoning.length ? safe.reasoning : ['No reasoning returned.'],
    dataSourcesUsed:
      Array.isArray(safe.dataSourcesUsed) && safe.dataSourcesUsed.length
        ? safe.dataSourcesUsed
        : [activeProvider === 'mock' ? 'Mock dataset (illustrative)' : activeProvider],
    missingData: Array.isArray(safe.missingData) && safe.missingData.length ? safe.missingData : ctx.missingData,
    disclaimer:
      safe.disclaimer ||
      (isHeuristic
        ? 'This is an AI prediction (local heuristic, no live model), not a guaranteed result.'
        : 'This is an AI prediction, not a guaranteed result.'),
    meta: {
      engine: isHeuristic ? 'local-heuristic' : `${activeProvider}-context + AI`,
      usedMockData: activeProvider === 'mock',
    },
  };
}

export default { generatePrediction };
