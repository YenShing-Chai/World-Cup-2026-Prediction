/**
 * Vercel serverless entrypoint.
 *
 * Vercel does not run a persistent server; instead it invokes an exported
 * handler per request. Our Express app instance IS a valid (req, res) handler,
 * so we simply re-export it. All routing (static files, /api/*, SPA fallback)
 * is handled inside the Express app exactly as it is locally.
 *
 * Set FOOTBALL_API_* and AI_* as Environment Variables in the Vercel dashboard
 * (Project → Settings → Environment Variables) — never commit them.
 */
import app from '../server/server.js';

export default app;
