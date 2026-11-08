// Self-healing fixer, Vercel side (shared module; files starting with _ are not routes).
//  - fixerButton({ bot, cb }): handles Telegram buttons fx:<a|x|r>:<s|b>:<id> from the fixer's messages
//      a = Approve -> squash-merge the fix PR via the GitHub API, then re-dispatch the failed job on the new code
//      x = Reject  -> close the PR, delete its branch
//      r = Retry   -> re-run the failed jobs of that run (transient / config cases)
//  - reportError(err, ctx): called from the top-level catch of api/telegram.mjs and api/studio.mjs.
//      transient -> ignored; missing env var -> Telegram tells you which; code bug -> repository_dispatch
//      fix-request to the repo that holds the proxy mirror (proxy-src/ in GH_REPO), deduped, never for its own errors.
// State: fixer_state.json on the fixer-state branch of each repo (same file tools/fixer.py writes).
// Env (all already on Vercel): STUDIO_TOKEN, STUDIO_REPO, STUDIO_TG_TOKEN, STUDIO_CHAT_ID, GH_TOKEN, GH_REPO,
//   TELEGRAM_TOKEN, ALLOWED_CHAT_ID. Optional: FIXER_PROXY_REPO (defaults to GH_REPO).
import RULES from './_fixer_rules.mjs';

const STATE_BRANCH = 'fixer-state';
const STATE_FILE = 'fixer_state.json';

export function repoFor(key) {
  const e = process.env;
  if (key === 's') return { key, repo: (e.STUDIO_REPO || '').trim(), token: e.STUDIO_TOKEN, tg: e.STUDIO_TG_TOKEN, chat: (e.STUDIO_CHAT_ID || '').trim(), name: 'Shorts Studio' };
  if (key === 'b') return { key, repo: (e.GH_REPO || '').trim(), token: e.GH_TOKEN, tg: e.TELEGRAM_TOKEN, chat: (e.ALLOWED_CHAT_ID || '').trim(), name: 'Browser agent' };
  return null;
}
const botKey = (bot) => (bot === 'studio' ? 's' : 'b');

// ---------------------------------------------------------------- classifier (same rules + logic as tools/fixer.py)
const ERRORISH = /(?:Error|Exception|NoAudioReceived|error:|ERR!|fatal:|^E: |failed|Failed|Unauthorized|Forbidden|denied|timed out|not set|missing|Too Many Requests|429|5\d\d)/m;
const GENERIC = /Process completed with exit code|^##\[(?:group|endgroup)\]|^\s*$/;
const rx = (r) => new RegExp(r.pattern, r.case ? '' : 'im');
export function focusLines(text) {
  return String(text || '').split('\n').filter((l) => l && !l.startsWith('    ') && !GENERIC.test(l) && ERRORISH.test(l)).slice(-6);
}
function match(kind, text) {
  for (const r of RULES[kind] || []) { const m = rx(r).exec(text); if (m) return [r, m]; }
  return [null, null];
}
// ---- Taskmaster: a spent free allowance is not a bug - wait for the refill ----
function quotaBackoff(r) {
  if (r.backoff) return Number(r.backoff);
  if (String(r.reset) === 'daily') {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 5, 0));
    return Math.max(60, Math.round((next - now) / 1000));
  }
  const n = parseInt(r.reset, 10);
  return n > 0 ? n : 120;
}

export function classify(text) {
  text = String(text || '');
  const focus = focusLines(text), ftext = focus.join('\n');
  const lines = text.trim().split('\n');
  const last = focus.length ? focus[focus.length - 1] : lines[lines.length - 1] || '';
  let res = null;
  for (const scope of [ftext, text]) {
    for (const kind of ['config', 'transient', 'quota']) {
      const [r, m] = match(kind, scope);
      if (r) {
        res = { kind, rule: r.id, label: r.label || '', backoff: r.backoff || 0 };
        if (kind === 'quota') { res.backoff = quotaBackoff(r); res.reset = r.reset || ''; res.resume_at = Math.floor(Date.now() / 1000) + res.backoff; }
        if (kind === 'config') res.secret = r.secret_group ? m[r.secret_group] : (r.secret || '');
        break;
      }
    }
    if (res) break;
    if (scope === ftext) { let [r] = match('code', ftext); if (r) { [r] = match('code', text); res = { kind: 'code', rule: r.id, label: r.label || '' }; break; } }
  }
  if (!res) { const [r] = match('code', text); res = r ? { kind: 'code', rule: r.id, label: r.label || '' } : { kind: 'unknown', rule: '', label: 'unrecognised failure' }; }
  res.line = last.trim().slice(0, 300);
  return res;
}
export function normalise(line) {
  return String(line).replace(/https?:\/\/\S+/g, '<url>').replace(/(\/[\w.-]+)+\//g, '').replace(/0x[0-9a-f]+|\b[0-9a-f]{7,40}\b/gi, '<h>')
    .replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 200);
}

// ---------------------------------------------------------------- GitHub + Telegram
async function gh(R, method, path, body) {
  const r = await fetch(`https://api.github.com/repos/${R.repo}${path}`, {
    method, signal: AbortSignal.timeout(12000),
    headers: { Authorization: 'Bearer ' + R.token, Accept: 'application/vnd.github+json', 'User-Agent': 'llm-proxy-fixer', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let d = {};
  try { d = await r.json(); } catch (e) {}
  return [r.status, d];
}
async function tgCall(token, method, body) {
  if (!token) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', signal: AbortSignal.timeout(8000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return await r.json();
  } catch (e) { return null; }
}

export async function loadState(R) {
  const [code, f] = await gh(R, 'GET', `/contents/${STATE_FILE}?ref=${STATE_BRANCH}`);
  let data = {};
  if (code === 200 && f.content) { try { data = JSON.parse(Buffer.from(f.content, 'base64').toString()); } catch (e) {} }
  for (const k of ['signatures', 'fixes', 'retries', 'notified', 'reports']) data[k] = data[k] || {};
  return { data, sha: code === 200 ? f.sha : undefined };
}
// mutate(data) is re-applied on top of a fresh copy when someone else wrote first (409/422).
export async function updateState(R, mutate, message = 'fixer state [skip ci]') {
  for (let i = 0; i < 4; i++) {
    const st = await loadState(R);
    const out = await mutate(st.data);
    if (out === false) return st.data;
    if (!st.sha && i === 0) await ensureBranch(R);
    const [code] = await gh(R, 'PUT', `/contents/${STATE_FILE}`, { message, branch: STATE_BRANCH, content: Buffer.from(JSON.stringify(st.data, null, 1)).toString('base64'), ...(st.sha ? { sha: st.sha } : {}) });
    if (code === 200 || code === 201) return st.data;
    if (![409, 422].includes(code)) throw new Error('state save failed ' + code);
  }
  throw new Error('state save kept conflicting');
}
async function ensureBranch(R) {
  const [c] = await gh(R, 'GET', `/git/ref/heads/${STATE_BRANCH}`);
  if (c === 200) return;
  const [, repo] = await gh(R, 'GET', '');
  const [c2, ref] = await gh(R, 'GET', `/git/ref/heads/${repo.default_branch || 'main'}`);
  if (c2 === 200) await gh(R, 'POST', '/git/refs', { ref: `refs/heads/${STATE_BRANCH}`, sha: ref.object.sha });
}

// Re-start the failed job on the new code (same request / inputs). Mirrors redispatch() in tools/fixer.py.
export async function redispatch(R, fix) {
  const t = fix.trigger || {};
  if (t.event === 'repository_dispatch' && t.action) {
    const [c] = await gh(R, 'POST', '/dispatches', { event_type: t.action, client_payload: t.client_payload || {} });
    return c === 204 ? 're-sent the same request' : `could not re-send it (GitHub ${c})`;
  }
  if (t.event === 'workflow_dispatch' && fix.workflow_path) {
    const wf = fix.workflow_path.split('/').pop();
    const [c] = await gh(R, 'POST', `/actions/workflows/${wf}/dispatches`, { ref: t.ref || fix.base_branch || 'main', inputs: t.inputs || {} });
    return c === 204 ? 're-ran it with the same inputs' : `could not re-run it (GitHub ${c})`;
  }
  if (/^\d+$/.test(String(fix.run_id || ''))) {
    const [c] = await gh(R, 'POST', `/actions/runs/${fix.run_id}/rerun-failed-jobs`);
    return c === 201 ? 're-ran the old run (the next new run gets the fix)' : `could not re-run (GitHub ${c})`;
  }
  return 'the next run will use it';
}

async function merge(R, fix) {
  const title = `fixer: ${fix.summary || 'fix'} (#${fix.pr})`;
  let [c, d] = await gh(R, 'PUT', `/pulls/${fix.pr}/merge`, { merge_method: 'squash', commit_title: title });
  if (c === 405 || c === 409) {
    await gh(R, 'PUT', `/pulls/${fix.pr}/update-branch`, {});
    await new Promise((r) => setTimeout(r, 3000));
    [c, d] = await gh(R, 'PUT', `/pulls/${fix.pr}/merge`, { merge_method: 'squash', commit_title: title });
  }
  return c === 200 ? { sha: d.sha } : { error: `GitHub ${c}: ${String(d.message || '').slice(0, 120)}` };
}

// ---------------------------------------------------------------- buttons
export async function fixerButton({ bot, cb }) {
  const m = /^fx:([axr]):([sb]):([0-9a-z]{1,24})$/.exec(String(cb?.data || ''));
  const R0 = repoFor(botKey(bot));
  const answer = (text) => tgCall(R0?.tg, 'answerCallbackQuery', { callback_query_id: cb.id, ...(text ? { text } : {}) });
  if (!m) { await answer('Unknown fixer button'); return true; }
  const [, act, key, id] = m;
  const R = repoFor(key);
  const chat = String(cb.message?.chat?.id || '');
  const reply = async (text) => {
    // Edit the fixer message in place (buttons go away), plus a short toast.
    const old = cb.message?.text || '';
    await tgCall(R0.tg, 'editMessageText', { chat_id: chat, message_id: cb.message?.message_id, text: (old ? old + '\n\n' : '') + text, disable_web_page_preview: true });
    await answer(text.slice(0, 190));
  };
  if (!R?.repo || !R.token) { await reply('⚠️ Fixer: repo or token missing on Vercel (' + (key === 's' ? 'STUDIO_REPO/STUDIO_TOKEN' : 'GH_REPO/GH_TOKEN') + ').'); return true; }
  const allowed = [R.chat, R0.chat].filter(Boolean);
  if (allowed.length && !allowed.includes(chat)) { await answer(); return true; }

  try {
    if (act === 'r') {
      if (!/^\d+$/.test(id)) { await reply('Nothing to re-run.'); return true; }
      const [c] = await gh(R, 'POST', `/actions/runs/${id}/rerun-failed-jobs`);
      await reply(c === 201 ? '🔁 Re-running it now.' : `⚠️ Could not re-run (GitHub ${c}).`);
      return true;
    }
    const st = await loadState(R);
    const fix = st.data.fixes[id];
    if (!fix) { await reply('⚠️ I can no longer find that fix.'); return true; }
    if (fix.chat_id && fix.chat_id !== chat && !allowed.includes(chat)) { await answer(); return true; }
    if (fix.status !== 'proposed') { await reply(`This fix is already ${fix.status}.`); return true; }

    if (act === 'x') {
      await gh(R, 'PATCH', `/pulls/${fix.pr}`, { state: 'closed' });
      await gh(R, 'DELETE', `/git/refs/heads/${fix.branch}`);
      await updateState(R, (d) => { if (d.fixes[id]?.status !== 'proposed') return false; Object.assign(d.fixes[id], { status: 'rejected', updated: Date.now() / 1000 }); });
      await reply(`❌ Rejected. PR #${fix.pr} closed, nothing changed.`);
      return true;
    }

    // Approve
    const res = await merge(R, fix);
    if (!res.sha) { await reply(`⚠️ Could not merge PR #${fix.pr} (${res.error}). Merge it on GitHub: https://github.com/${R.repo}/pull/${fix.pr}`); return true; }
    const mergedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    await updateState(R, (d) => { Object.assign(d.fixes[id] || (d.fixes[id] = fix), { status: 'merged', merged_sha: res.sha, merged_at: mergedAt, updated: Date.now() / 1000 }); });
    await gh(R, 'DELETE', `/git/refs/heads/${fix.branch}`);
    const again = fix.target === 'llm-proxy'
      ? 'This one is proxy code: in Termux run  bash ~/fixer/pull-proxy.sh  to apply it to ~/llm-proxy and deploy.'
      : await redispatch(R, fix);
    await reply(`✅ Approved. Merged PR #${fix.pr}; ${again}`);
  } catch (e) {
    await reply('⚠️ Fixer error: ' + String(e.message || e).slice(0, 200));
  }
  return true;
}

// ---------------------------------------------------------------- error reports from the proxy's own handlers
const SEEN = new Map(); // warm-instance dedupe
const DEDUPE_MS = 6 * 3600 * 1000;

function sigOf(cls, file) {
  let h = 0;
  const s = `${cls.kind}|${normalise(cls.line)}|${file || ''}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return 'v' + h.toString(16);
}
function topFile(stack) {
  const m = /(?:\/var\/task\/|\/)(api\/[\w./-]+\.m?js):(\d+)/.exec(String(stack || ''));
  return m ? m[1] : '';
}

// Never throws; keeps to ~6 s so the Telegram webhook still answers in time.
export async function reportError(err, ctx = {}, deps = {}) {
  try {
    const message = String(err?.message || err || '').slice(0, 1500);
    const stack = String(err?.stack || '').slice(0, 6000);
    if (/_fixer(_rules)?\.mjs|api\/fixer\.mjs/.test(stack)) return { skipped: 'fixer-own-error' };
    const cls = classify(`${message}\n${stack}`);
    if (cls.kind === 'transient') return { skipped: 'transient', cls };
    const file = ctx.file || topFile(stack);
    const sig = sigOf(cls, file);
    const now = deps.now ? deps.now() : Date.now();
    if (now - (SEEN.get(sig) || 0) < DEDUPE_MS) return { skipped: 'dedupe', sig };
    SEEN.set(sig, now);

    const src = repoFor(ctx.source === 'studio' ? 's' : 'b');       // the bot that tells the user
    const P = { ...repoFor('b'), repo: (process.env.FIXER_PROXY_REPO || process.env.GH_REPO || '').trim() }; // holds proxy-src/
    const where = ctx.source === 'studio' ? 'Shorts Studio bot (Vercel)' : 'Browser agent bot (Vercel)';
    const say = (text) => tgCall(src.tg, 'sendMessage', { chat_id: src.chat || String(ctx.chat || ''), text, disable_web_page_preview: true });
    // ---- Taskmaster: browser-bot quota failures park in the shared queue ----
    if (cls.kind === 'quota') {
      if (/studio/i.test(String(ctx.bot || ''))) return { skipped: 'quota-studio', cls };
      const now = Math.floor(Date.now() / 1000);
      const resume_at = now + (cls.backoff || 120);
      const task = { id: 'q' + now + '-' + Math.random().toString(36).slice(2, 6),
        bot: String(ctx.bot || 'b'), chat: String(ctx.chat || ''),
        kind: String(ctx.kind || 'deep'), payload: String(ctx.payload || ctx.task || 'continue'),
        rule: cls.rule, state: 'waiting', resume_at, tries: 1, created: now, note: cls.label || '' };
      const saved = await enqueueTask(task);
      await say('\u23f8 ' + (cls.label || 'Free quota exhausted') + (saved
        ? ' - queued as ' + task.id + '; Taskmaster resumes it in ' + Math.max(1, Math.round((resume_at - now) / 60)) + ' min.'
        : ' - queue write FAILED; say "continue" to resume manually.'));
      return { queued: saved ? task.id : null, cls };
    }


    // Cross-instance dedupe + attempt cap, in the proxy repo's fixer state.
    let skip = false;
    if (P.repo && P.token) {
      await updateState(P, (d) => {
        const r = d.reports[sig] || { count: 0, last: 0 };
        if (now - r.last < DEDUPE_MS || (d.signatures[sig]?.attempts || 0) >= 2) { skip = true; return false; }
        d.reports[sig] = { count: r.count + 1, last: now, line: cls.line.slice(0, 160), updated: now / 1000 };
      }).catch(() => {});
    }
    if (skip) return { skipped: 'already-reported', sig };

    if (cls.kind === 'config') {
      await say(`🔑 ${where} hit an error: ${cls.label}${cls.secret ? ': ' + cls.secret : ''}.\nFix: add it in Vercel → llm-proxy → Settings → Environment Variables, then run vercel --prod.\nNo code change.`);
      return { action: 'config', sig, cls };
    }
    let mirror = false;
    if (P.repo && P.token) { const [c] = await gh(P, 'GET', '/contents/proxy-src/.mirror'); mirror = c === 200; }
    if (!mirror) {
      await say(`🧩 ${where} crashed: ${cls.line.slice(0, 200)}${file ? ' (' + file + ')' : ''}.\nKind: code bug. Auto-fix for proxy code is off (no proxy-src mirror in ${P.repo || 'GH_REPO'}).`);
      return { action: 'told', sig, cls };
    }
    const [c] = await gh(P, 'POST', '/dispatches', { event_type: 'fix-request', client_payload: { source: ctx.source || 'proxy', signature: sig, message, stack, file, kind: cls.kind } });
    return { action: c === 204 ? 'dispatched' : 'dispatch-failed', status: c, sig, cls };
  } catch (e) {
    console.log('reportError failed', e?.message);
    return { skipped: 'error', error: String(e?.message || e) };
  }
}
export const _test = { SEEN, sigOf, topFile };

// Taskmaster: park a quota-paused task in kv 'taskq' (read by taskqTick in telegram.mjs)
async function enqueueTask(task) {
  try {
    const base = process.env.PROXY_BASE_URL
      || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL : 'https://llm-proxy-one-rose.vercel.app');
    const key = process.env.PROXY_KEY || '';
    const H = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key, 'x-proxy-key': key };
    const post = (body) => fetch(base + '/api/v1/memory', { method: 'POST', headers: H, body: JSON.stringify(body) });
    const g = await post({ op: 'kv_get', key: 'taskq' });
    const j = await g.json().catch(() => ({}));
    const doc = (j && j.value && typeof j.value === 'object') ? j.value : {};
    const tasks = Array.isArray(doc.tasks) ? doc.tasks : [];
    const now = Math.floor(Date.now() / 1000);
    const id = String(task.id || ('t' + now + Math.random().toString(36).slice(2, 6)));
    const i = tasks.findIndex((t) => t.id === id);
    const tries = i >= 0 ? Number(tasks[i].tries || 1) + 1 : 1;
    const next = { ...task, id, state: 'waiting', tries, resume_at: Number(task.resume_at || now + 3600) };
    if (i >= 0) tasks[i] = next; else tasks.push(next);
    const r = await post({ op: 'kv_put', key: 'taskq', value: { tasks, updated: now } });
    return r.ok ? next : null;
  } catch (e) {
    console.log('enqueueTask failed', e?.message);
    return null;
  }
}
