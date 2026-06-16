/**
 * Question generator.
 *
 * Core product behaviour: the app ALWAYS asks the user clarifying questions
 * before predicting. This module produces those questions. They are mostly
 * static (so the flow is reliable and offline-friendly) but a couple are
 * tailored using the match context.
 */

/**
 * @param {object} matchContext - output of buildMatchContext
 * @returns {{questions: object[]}}
 */
export function generateQuestions(matchContext) {
  const home = matchContext?.match?.homeTeam || 'Home';
  const away = matchContext?.match?.awayTeam || 'Away';

  const questions = [
    {
      id: 'predictionStyle',
      question: 'What kind of prediction do you want?',
      type: 'select',
      options: ['safe', 'balanced', 'high-risk'],
      help: 'Safe favours the stronger side; high-risk leans into possible upsets.',
      default: 'balanced',
    },
    {
      id: 'outputDepth',
      question: 'Win/Draw/Loss only, or also an exact score?',
      type: 'select',
      options: ['result-only', 'result-and-score'],
      default: 'result-and-score',
    },
    {
      id: 'markets',
      question: 'Which betting-style insights should I include?',
      type: 'multiselect',
      options: ['Over/Under 2.5', 'Both Teams To Score', 'Handicap', 'HT/FT Double'],
      help: 'These are analytical views, not betting advice. "HT/FT Double" = half-time/full-time combined result.',
      default: ['Over/Under 2.5', 'Both Teams To Score', 'HT/FT Double'],
    },
    {
      id: 'focus',
      question: 'What should the prediction weigh most heavily?',
      type: 'select',
      options: [
        'current tournament form',
        'historical strength',
        'squad quality',
        'odds market',
      ],
      help:
        matchContext?.contextFactors?.isMockData
          ? 'Note: running on mock data, so "odds market" has no live source.'
          : `Applied to ${home} vs ${away}.`,
      default: 'current tournament form',
    },
    {
      id: 'detail',
      question: 'Do you want a short answer or detailed reasoning?',
      type: 'select',
      options: ['short', 'detailed'],
      default: 'detailed',
    },
  ];

  return { questions };
}

export default { generateQuestions };
