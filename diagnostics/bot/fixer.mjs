// Fixer endpoint on the proxy (one function, to stay under Vercel Hobby's function cap).
//   POST /api/fixer?report=1   Authorization: Bearer <PROXY_KEY>   {source, message, stack, file}
//        -> same as reportError(): transient ignored, missing env -> Telegram note, code bug -> fix-request dispatch
//   GET  /api/fixer?key=<PROXY_KEY>   -> open / recent fixes in both repos (status check)
// Telegram buttons are NOT handled here: they arrive at the bots' own webhooks (api/telegram, api/studio),
// which hand fx:* callbacks to fixerButton() from ./_fixer.mjs.
import { reportError, loadState, repoFor } from './_fixer.mjs';
export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const key = process.env.PROXY_KEY || '';
  const given = (req.headers.authorization || '').replace('Bearer ', '') || req.query?.key || '';
  if (!key || given !== key) return res.status(401).json({ error: 'unauthorized' });
  if (req.method === 'POST' && (req.query?.report || req.query?.op === 'report')) {
    const b = req.body || {};
    const err = { message: String(b.message || 'error'), stack: String(b.stack || '') };
    const out = await reportError(err, { source: String(b.source || 'external'), file: b.file || '', chat: b.chat || '' });
    return res.status(200).json(out);
  }
  const out = {};
  for (const k of ['s', 'b']) {
    const R = repoFor(k);
    if (!R?.repo || !R.token) { out[k] = 'not configured'; continue; }
    try {
      const { data } = await loadState(R);
      out[R.name] = Object.entries(data.fixes).slice(-10).map(([id, f]) => ({ id, pr: f.pr, status: f.status, summary: f.summary, workflow: f.workflow }));
    } catch (e) { out[R.name] = 'error ' + e.message; }
  }
  return res.status(200).json(out);
}
