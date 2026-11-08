import { judgeImages } from './_match.mjs';
// Shorts Studio bot: its own Telegram bot, living on the same proxy as the browser bot.
// Topic -> research (the browser bot's Google search tool) -> pitch (approve) -> fact-checked script (approve)
// -> director picks a tool per shot (Cloudflare FLUX, PixelLab, Hugging Face motion) -> GitHub render assembles it -> MP4 + Studio mini app.
// Remembers the chat and past shorts; parks work when a free quota runs out and resumes it later (ask first or automatically).
// Env (Vercel): STUDIO_TG_TOKEN, STUDIO_TOKEN, STUDIO_REPO, STUDIO_CHAT_ID, PROXY_KEY, GROQ_API_KEY
// Optional: STUDIO_TG_SECRET (falls back to TG_SECRET), STUDIO_VOICE
// Engine step 2: chat re-edits of saved projects (editRequest), /scenes /history /undo /restore /project, helpers in ./_timeline.mjs
import crypto from 'node:crypto';
import * as TLX from './_timeline.mjs';
import * as SX from './_style.mjs';
import { fixerButton, reportError } from './_fixer.mjs';
export const config = { maxDuration: 60 };

const TG = process.env.STUDIO_TG_TOKEN;
const GH = process.env.STUDIO_TOKEN;
const REPO = (process.env.STUDIO_REPO || '').trim();
const ALLOWED = (process.env.STUDIO_CHAT_ID || '').trim();
const SECRET = process.env.STUDIO_TG_SECRET || process.env.TG_SECRET || '';
const STATE = 'state/studio.json';

// Canvas shapes a project can render at (any WxH also works through /reformat 1280x720).
const FORMATS = { vertical: '9:16', landscape: '16:9', square: '1:1', portrait: '4:5' };
const FORMAT_LABEL = { vertical: 'vertical 9:16 (Shorts)', landscape: 'landscape 16:9 (YouTube)', square: 'square 1:1', portrait: 'portrait 4:5 (feed)' };
const fmtOf = (set) => (FORMATS[set?.format] ? set.format : 'vertical');
const CAPTION_PRESETS = ['bold-pop', 'karaoke-box', 'clean', 'subtitle', 'neon', 'word-by-word'];
function canvasFor(arg) {
  const a = String(arg || '').toLowerCase().trim();
  const name = Object.keys(FORMATS).find((k) => k === a || FORMATS[k] === a) || (a === 'youtube' ? 'landscape' : a === 'shorts' ? 'vertical' : '');
  const ratio = name ? FORMATS[name] : a;
  let m = ratio.match(/^(\d{2,5})x(\d{2,5})$/);
  if (m) return { width: +m[1] - (+m[1] % 2), height: +m[2] - (+m[2] % 2), fps: 30 };
  m = ratio.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const r = +m[1] / +m[2], even = (n) => Math.round(n / 2) * 2;
  return r >= 1 ? { width: even(1080 * r), height: 1080, fps: 30 } : { width: 1080, height: even(1080 / r), fps: 30 };
}
const slug = (t) => (String(t || 'video').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36).replace(/-+$/, '') || 'video');

const MUSIC = ['docu-pluck', 'cinematic-min', 'ambient-pad', 'lofi-warm', 'tech-pulse', 'lullaby-tender'];
const ACCENTS = { gold: '#FFD43B', red: '#FF5A5F', teal: '#2EE6C5', blue: '#5AA9FF', white: '#FFFFFF' };

const RULES = `Writing rules (never break):
- Line 1 is the hook: a number, a named person or object, or a vivid scene. Never open with "Why", a question about the viewer, or a greeting.
- Voice the common wrong belief, then break it. One running example. Show, then name.
- Bridge beats with cause and effect ("so", "but", "then"). A dry deadpan line after dense stretches. Payoff at 60-80%. Close on one short repeatable line.
- Banned: the "not X, but Y" pattern and its variants ("it's not..., it's...", "X isn't the problem, Y is", "less about X, more about Y"), em dashes, "here's the thing", "let that sink in", "the truth is", "delve", "unlock", "game-changer", "in today's world", "imagine a world", filler lists of three, emojis, hashtags.
- Plain spoken English, short sentences, numbers written as people say them.
- Every fact, name, number and date must come from the RESEARCH notes. Never invent a statistic. If the research does not support a claim, leave it out.
- Faceless visuals only (no real identifiable faces), single narrator.`;

const PITCH = `You are the showrunner of a faceless YouTube Shorts / TikTok channel. Pitch ONE short about the user's topic, built on the research notes.
Return JSON only:
{"title": "<= 7 words, punchy, no 'Why'", "hook": "the exact first spoken line", "angle": "1-2 sentences: the wrong belief and the twist",
 "key_facts": ["3 to 5 checkable facts from the research that the short will use"],
 "visual_style": "one consistent art style for every image, e.g. 'moody cinematic photo, film grain' or 'paper cut-out collage'",
 "length_seconds": 35-55, "music": one of ${JSON.stringify(MUSIC)}, "accent": one of ${JSON.stringify(Object.keys(ACCENTS))}}
${RULES}`;

// The pitch also picks the STYLE RECIPE (the whole look and edit, not just the image style) and respects the
// format/length/style the user asked for in their own words (parsed by SX.parseJob).
function pitchPrompt(job = {}, learned = null, recent = []) {
  const len = job.length ? `${job.length}` : '35-55';
  const long = (job.length || 0) >= 100;
  const style = learned ? `The user chose their learned style "${learned.name}": ${learned.summary} Set "style" to "${learned.name}" and write visual_style from it: ${learned.image_style}`
    : job.style ? `The user asked for the "${job.style}" style (${SX.RECIPES[job.style].label}). Set "style" to "${job.style}". visual_style should build on: ${SX.RECIPES[job.style].image}`
    : `Pick the style recipe that fits THIS topic best:\n${SX.recipeMenu()}\n${recent.length ? `Recent videos used: ${recent.join(', ')}. Pick a different one unless this topic clearly needs the same.` : ''}`;
  return PITCH.replace('You are the showrunner of a faceless YouTube Shorts / TikTok channel.', long ? 'You are the showrunner of a faceless YouTube channel making long-form narrated videos.' : 'You are the showrunner of a faceless YouTube Shorts / TikTok channel.')
    .replace('"length_seconds": 35-55', `"length_seconds": ${len}, "style": "recipe name", "style_reason": "max 12 words: why this look fits"`)
    .replace('Pitch ONE short', long ? 'Pitch ONE video' : 'Pitch ONE short') + `\n\nSTYLE: ${style}${SX.whatifPitchNote(job, learned)}${SX.storyPitchNote(job)}${job.length ? `\nLENGTH: the user asked for about ${job.length} seconds; keep length_seconds at ${job.length}.` : ''}`;
}

const SCRIPT = `Write the full narration script for this approved pitch as 6 to 9 beats. About 2.5 spoken words per second, so total words
should match the length (45 seconds = about 110 words). Each beat = one visual on screen (an image, or an animated graphic for beats built on numbers).
Return JSON only:
{"title": "...", "beats": [{"narration": "1-2 short sentences", "image_prompt": "concrete visual scene for this beat, framed for the video format (vertical or landscape), no text, no logos, no real faces", "tool": "flux | pixellab | higgsfield | stock | graphic", "graphic": "only for graphic beats: see the director rules", "motion": "only for higgsfield: camera move and action", "still": "only for higgsfield or stock: flux or pixellab", "query": "only for stock: 2-4 plain words to search stock footage for"}],
 "fact_check": [{"claim": "a factual claim in the script", "supported": true or false}]}
${RULES}`;


const BANNED = /—|\bnot (just |only |merely )?\w+(,| but)|\bisn't the problem\b|here'?s the thing|let that sink in|the truth is|\bdelve|\bunlock|game.?changer|in today'?s world|imagine a world|^why\b/gim;
const YES = /^\s*(yes|yep|yeah|ok|okay|approve[d]?|go|go ahead|looks good|perfect|great|nice|do it|render( it)?|send it|👍|✅)\W*$/i;
const NO = /^\s*(cancel|stop|forget it|never ?mind|no thanks)\W*$/i;

let BASE = '';
let APP = '';

// ---------- Telegram ----------
async function tg(method, body) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return await r.json();
  } catch (e) { return null; }
}
const send = (chat, text, markup) => tg('sendMessage', { chat_id: chat, text: text.slice(0, 4000), disable_web_page_preview: true, ...(markup ? { reply_markup: markup } : {}) });
const typing = (chat) => tg('sendChatAction', { chat_id: chat, action: 'typing' });
const appButton = (label = '🎞 Open Studio') => ({ inline_keyboard: [[{ text: label, web_app: { url: APP } }]] });

const PITCH_BUTTONS = { inline_keyboard: [[{ text: '✅ Write the script', callback_data: 'approve' }], [{ text: '🔁 New angle', callback_data: 'redo' }, { text: '❌ Cancel', callback_data: 'cancel' }]] };
const SCRIPT_BUTTONS = { inline_keyboard: [[{ text: '🎬 Approve & render', callback_data: 'approve' }], [{ text: '🔁 Rewrite', callback_data: 'redo' }, { text: '❌ Cancel', callback_data: 'cancel' }]] };

// ---------- GitHub (state lives in the shorts-studio repo) ----------
function gh(path, opts = {}) {
  return fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    ...opts, headers: { Authorization: 'Bearer ' + GH, Accept: 'application/vnd.github+json', 'User-Agent': 'shorts-studio-bot', 'Content-Type': 'application/json' },
  });
}
let SHA;
async function load() {
  const r = await gh('contents/' + STATE);
  if (!r.ok) { SHA = undefined; return {}; }
  const f = await r.json();
  SHA = f.sha;
  try { return JSON.parse(Buffer.from(f.content, 'base64').toString()); } catch (e) { return {}; }
}
async function save(s) {
  s.time = Date.now();
  for (let i = 0; i < 3; i++) {
    const r = await gh('contents/' + STATE, { method: 'PUT', body: JSON.stringify({ message: 'studio state [skip ci]', content: Buffer.from(JSON.stringify(s, null, 2)).toString('base64'), sha: SHA }) });
    if (r.ok) { SHA = (await r.json()).content.sha; return; }
    if (![409, 422].includes(r.status)) return;
    // Another message was handled at the same time: keep its renders and ideas, then write ours on top.
    const SHA0 = SHA; const other = await load();
    if (SHA === SHA0) return;
    s.renders = [...new Map([...(other.renders || []), ...(s.renders || [])].map((x) => [x.title, x])).values()];
    s.projects = s.projects?.length ? s.projects : other.projects;
  }
}

// ---------- Shared proxy tools (same ones the browser bot uses) ----------
async function proxy(path, body, ms = 25000) {
  const r = await fetch(BASE + path, { signal: AbortSignal.timeout(ms), method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.PROXY_KEY }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(path + ' ' + r.status + ' ' + (await r.text()).slice(0, 120));
  return r.json();
}
// smart = strongest Gemini first (writing); lean = the fast default chain (routing, pings), which saves the smart quota.
async function llm(messages, temperature = 0.6, smart = true) {
  const body = { messages, temperature, ...(smart ? { model: 'smart' } : {}), response_format: { type: 'json_object' } };
  let d;
  const errors = [];
  // Smart model first with a short leash; if it is slow or times out (Vercel 504), fall back to the fast chain
  // so the whole request stays inside this function's 60s limit.
  const tries = smart ? [[body, 28000], [{ ...body, model: undefined }, 25000]] : [[body, 40000]];
  for (const [b, ms] of tries) {
    try { d = await proxy('/api/v1/chat/completions', b, ms); break; } catch (e) { errors.push(e.name === 'TimeoutError' ? 'llm timeout ' + ms / 1000 + 's' : e.message); }
  }
  if (!d) throw new Error(errors.join(' / '));
  let t = (d.choices?.[0]?.message?.content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  if (!t.startsWith('{')) { const a = t.indexOf('{'), b = t.lastIndexOf('}'); t = t.slice(a, b + 1); }
  return JSON.parse(t);
}
async function research(topic, query) {
  const q = { query: query || `Key facts, numbers, dates, names and surprising details about: ${topic}. Include the most common misconception about it.` };
  for (const p of ['/api/v1/search', '/api/search']) {
    try {
      const d = await proxy(p, q);
        return { text: (d.text || '').slice(0, 6000), sources: (d.sources || []).slice(0, 5) };
    } catch (e) {}
  }
  return { text: '', sources: [] };
}

// ---------- Shared memory with the assistant bot (one store on the proxy, both bots read and write it) ----------
let LEARN_NEXT = null; // an exchange to learn from once the reply has gone out
// ---------- Cohort: the browser bot (assistant) does deep research and posts it back here ----------
async function askBrowserBot(chat, job) {
  const token = process.env.GH_TOKEN, repo = (process.env.GH_REPO || '').trim();
  if (!token || !repo) return false;
  const task = '[studio-research] ' + JSON.stringify({ ...job, callback: BASE + '/api/studio?research=1' });
  const r = await fetch(`https://api.github.com/repos/${repo}/dispatches`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_type: 'run-browser-agent', client_payload: { task, prompt: task, chat_id: chat } }) });
  if (!r.ok) console.log('browser bot dispatch', r.status, (await r.text()).slice(0, 200));
  return r.ok;
}
async function researchBack(req, res) {
  if ((req.headers.authorization || '').replace('Bearer ', '') !== process.env.PROXY_KEY) return res.status(401).end();
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const s = await load();
  const chat = ALLOWED || s.chat;
  if (!chat) return res.status(400).json({ error: 'no chat' });
  const text = String(b.text || '').slice(0, 9000), sources = (b.sources || []).slice(0, 12);
  if (b.purpose === 'study') {
    if (!text) { await send(chat, '📚 The study run came back empty. Ask me again and I will retry.'); return res.status(200).json({ ok: false }); }
    const pb = await llm([{ role: 'system', content: 'Merge the old producer playbook with the new findings into one playbook, max 450 words, same sections (HOOKS, PACING & CUTS, CAPTIONS & FONTS, VISUAL STYLE & IMAGE/ART PREFERENCES, SOUND, ENDINGS/LOOPS, DO NOT). Keep confirmed rules, drop contradicted or vague ones. Return JSON {"playbook": "...", "changes": "1-2 sentences on what changed"}.' },
      { role: 'user', content: `OLD:\n${s.playbook || '(none)'}\n\nNEW FINDINGS:\n${text}` }], 0.3).catch(() => ({ playbook: text.slice(0, 3000), changes: 'First playbook saved.' }));
    s.playbook = String(pb.playbook || text).slice(0, 4000); s.playbook_at = Date.now();
    await save(s);
    await hive('add', { items: [{ kind: 'preference', text: 'Shorts producer playbook: ' + s.playbook.slice(0, 600), tags: ['playbook', 'short'] }] });
    await send(chat, `📚 Studied ${sources.length} sources and updated my producer playbook. ${pb.changes || ''}\n\n${s.playbook.slice(0, 3000)}`);
    return res.status(200).json({ ok: true });
  }
  if (b.purpose === 'ideas') {
    const ideas = (b.ideas || []).filter((x) => x && x.topic && x.title).slice(0, 4);
    if (!ideas.length) { await save(s); await send(chat, "🌐 The browser bot came back without solid ideas this time. Tap 🔄 More ideas, or send a topic."); return res.status(200).json({ ok: false }); }
    Object.assign(s, { ideas, ideas_at: Date.now() });
    await save(s);
    const list = ideas.map((x, i) => `${i + 1}. ${x.title}\n   ${x.why || ''}`).join('\n\n');
    await send(chat, `🌐 Deep-dug ideas from your browser bot:\n\n${list}`, { inline_keyboard: [...ideas.map((x, i) => [{ text: `💡 ${i + 1}. ${x.title}`.slice(0, 60), callback_data: 'idea:' + i }]), [{ text: '🔄 More ideas', callback_data: 'ideas' }]] });
    return res.status(200).json({ ok: true });
  }
  if (!text) { s.deep = null; await save(s); return res.status(200).json({ ok: false }); }
  const same = s.topic && b.topic && s.topic.toLowerCase() === String(b.topic).toLowerCase();
  if (same) {
    s.research = { text: `${s.research?.text || ''}\n\nDEEP RESEARCH (browser bot, read the pages itself):\n${text}`.slice(-14000), sources: [...(s.research?.sources || []), ...sources].slice(0, 16) };
    s.deep = { topic: s.topic, status: 'done', at: Date.now() };
    await save(s);
    const btn = s.stage === 'script' ? [{ text: '🔁 Rewrite the script with it', callback_data: 'deep:script' }] : s.stage === 'pitch' ? [{ text: '🔁 Re-pitch with it', callback_data: 'deep:pitch' }] : null;
    await send(chat, `🌐 Your browser bot finished its deep research on "${String(b.topic).slice(0, 60)}" (${sources.length} sources). ${s.stage === 'pitch' ? "It'll feed the script when you approve." : s.stage === 'script' ? 'Want the script rebuilt on it?' : 'Saved with the project.'}`, btn ? { inline_keyboard: [btn] } : undefined);
  } else await save(s);
  await hive('add', { items: [{ kind: 'fact', text: `Browser bot research on ${b.topic}: ${text.slice(0, 300)}`, tags: ['research', 'short'] }] });
  return res.status(200).json({ ok: true, used: same });
}

async function hive(op, body = {}) {
  try { return await proxy('/api/v1/memory', { op, source: 'studio', ...body }); } catch (e) { console.log('hive', op, e.message); return null; }
}
function hiveText(h) {
  if (!h) return '';
  const out = [];
  if (h.profile?.length) out.push('About the user:\n' + h.profile.map((x) => '- ' + x.text).join('\n'));
  if (h.memories?.length) out.push('Relevant memories:\n' + h.memories.map((x) => `- (${x.kind}) ${x.text}`).join('\n'));
  if (h.news?.length) out.push('Lately in the assistant bot:\n' + h.news.map((x) => '- ' + x.text).join('\n'));
  return out.length ? 'SHARED MEMORY (from both bots; use it to fit the user, never quote it back):\n' + out.join('\n') : '';
}

// ---------- Topic ideas: researched, fitted to what the user likes, never a repeat ----------
const IDEAS = `You run the research desk of a faceless YouTube Shorts / TikTok channel (45-second explainers with narration and AI visuals).
Suggest 4 short ideas for right now. At least two should fit the user's interests in the shared memory (if there are any); the rest come from the trending research.
Every idea must rest on real facts from the research or on widely verifiable history. Never repeat a short already made.
Return JSON only: {"ideas": [{"topic": "the subject in max 10 words, ready to research", "title": "punchy title, max 7 words", "why": "one line: the hook, and why now or why it fits them"}]}`;

async function suggest(chat, s, fresh = false, intro = '') {
  if (intro) await send(chat, intro);
  if (fresh || !s.ideas?.length || Date.now() - (s.ideas_at || 0) > 6 * 3600e3) {
    await typing(chat);
    try {
      const made = (s.projects || []).map((p) => p.title);
      const [mem, trends] = await Promise.all([
        hive('recall', { query: 'interests topics shorts ideas liked ' + (s.projects || []).map((p) => p.topic).join(' '), limit: 15 }),
        research('', `What surprising stories, discoveries, anniversaries, records and debates are people talking about this week (today is ${new Date().toDateString()}) that would make gripping 45-second explainer shorts? Give specific facts, names and dates.`),
      ]);
      const d = await llm([{ role: 'system', content: IDEAS }, { role: 'user', content: `${hiveText(mem)}\n\nAlready made: ${made.join('; ') || 'none'}\nIdeas shown last time (offer new ones): ${(s.ideas || []).map((x) => x.title).join('; ') || 'none'}\n\nTRENDING RESEARCH:\n${trends.text || '(search unavailable today)'}` }], 0.9);
      if ((d.ideas || []).length) Object.assign(s, { ideas: d.ideas.slice(0, 4), ideas_at: Date.now() });
    } catch (e) { console.log('ideas failed', e.message); }
  }
  await save(s);
  if (!s.ideas?.length) return send(chat, "🎬 Tell me what the next short is about, e.g. /short the history of the Lagos lagoon.");
  const list = s.ideas.map((x, i) => `${i + 1}. ${x.title}\n   ${x.why}`).join('\n\n');
  const rows = s.ideas.map((x, i) => [{ text: `💡 ${i + 1}. ${x.title}`.slice(0, 60), callback_data: 'idea:' + i }]);
  return send(chat, `💡 Ideas for your next short:\n\n${list}\n\nTap one, or send any topic of your own.`, { inline_keyboard: [...rows, [{ text: '🔄 More ideas', callback_data: 'ideas' }, { text: '🌐 Deep-dig (browser bot)', callback_data: 'ideas:deep' }]] });
}

async function transcribe(fileId) {
  const f = await tg('getFile', { file_id: fileId });
  if (!f?.ok) return '';
  const audio = await (await fetch(`https://api.telegram.org/file/bot${TG}/${f.result.file_path}`)).arrayBuffer();
  const form = new FormData();
  form.append('file', new Blob([audio], { type: 'audio/ogg' }), 'voice.ogg');
  form.append('model', 'whisper-large-v3-turbo');
  const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.GROQ_API_KEY }, body: form });
  return ((await r.json()).text || '').trim();
}


// ---------- Memory ----------
function remember(s, role, text) {
  s.history = [...(s.history || []), { role, text: String(text).slice(0, 300), t: Date.now() }].slice(-16);
}
function context(s) {
  const last = (s.projects || [])[0];
  return [
    `Stage: ${s.stage || 'idle'}${s.pitch ? `, current short: "${s.pitch.title}"` : ''}`,
    `Rendering in the background (runs by itself, never blocks anything): ${(s.renders || []).filter((x) => Date.now() - x.at < 25 * 60e3).map((x) => `"${x.title}"`).join(', ') || 'nothing'}`,
    last ? `Last finished short: "${last.title}" (topic: ${last.topic})` : 'No finished shorts yet',
    currentProject(s) ? `Project that edits apply to: "${currentProject(s).title}" (${currentProject(s).id})` : 'No editable project yet',
    s.pending_edit ? `Edit waiting for Apply/Cancel: ${s.pending_edit.summary}` : 'No edit waiting',
    s.pending ? `Paused job: "${s.pending.title}" at the ${s.pending.step} step (${s.pending.service} limit), auto-resume: ${s.pending.auto ? 'on' : 'off'}` : 'No paused job',
    `Settings: format ${FORMAT_LABEL[fmtOf(s.settings)]} (9:16, 16:9, 1:1 and 4:5 all supported; the user can switch any time; /reformat re-shapes the last short without remaking it), Hugging Face motion ${s.settings?.higgsfield === false ? 'off' : 'on'} (max ${s.settings?.max_motion ?? 2} clips), PixelLab ${s.settings?.pixellab === false ? 'off' : 'on'}`,
    `Look for new videos: ${s.settings?.style ? `learned style "${s.settings.style}"` : s.settings?.recipe ? `recipe ${s.settings.recipe}` : 'auto (picked per topic)'}; learned styles: ${Object.keys(s.styles || {}).join(', ') || 'none'}`,
    'Recent chat:\n' + (s.history || []).slice(-10).map((h) => `${h.role}: ${h.text}`).join('\n'),
  ].join('\n');
}

const ROUTER = `You are the brain of a Shorts Studio Telegram bot. Using the context and the new message, decide what the user wants.
Return JSON only: {"intent": "...", "target": "pitch|script|video", "feedback": "...", "topic": "...", "url": "", "auto": true, "settings": {}, "reply": "..."}
intents:
- approve: accepts what is waiting (yes, ok, go, render it).
- edit: a concrete change to the finished video (the project edits apply to) when no pitch or script is waiting, and the message is clearly about THAT video (its scenes, captions, music, look): a scene's picture or words, the hook, the ending, cut/add/reorder scenes, captions, music, voice or pacing, shape (16:9, square...), title, transitions, colours. feedback = the change in plain words. It is applied to the saved video without starting over.
- revise: wants a change to the current pitch or script, or a full remake of the LAST finished short ("redo it", "again", "start over", "a fresh take"). target = "pitch" if a pitch is waiting, "script" if a script is waiting, "video" for a full remake of a short already rendered. feedback = the change in plain words ("redo it" with no detail = "a fresh take with a stronger hook and new visuals").
- cancel: stop the current short.
- new_topic: asks for a video about a NEW subject or a different story ("make a video about...", "create a documentary of...", "the daily life of a guy named Adam", "I meant <a different subject>"). A style, length or shape named together with a subject ("in stop motion style", "3 mins for YouTube") makes it a NEW video, never an edit. topic = the whole request in the user's words (subject plus style/length/shape words).
- learn_style: wants the bot to learn or copy the style of a reference video ("make it look like this", "learn this style", sends a link to copy). url = the link if any.
- resume: continue the paused job right now.
- resume_later: continue the paused job by itself when the limit resets (auto=true), or ask first next time (auto=false).
- settings: turn tools on/off or change how many motion clips. settings = {"higgsfield": bool, "pixellab": bool, "max_motion": number, "gemini_images": bool, "graphics": bool, "format": "vertical" | "landscape" | "square" | "portrait", "caption_style": "bold-pop" | "karaoke-box" | "clean" | "subtitle" | "neon" | "word-by-word", "recipe": one of ${JSON.stringify(SX.RECIPE_NAMES)} or "auto" (the default look for new videos; auto = I pick per topic), "style": a learned style name or "none"} (format: landscape = 16:9 like a normal YouTube video, vertical = 9:16 Shorts, square = 1:1, portrait = 4:5 feed post) (graphics = animated charts, counters and titles) (only keys they mentioned).
- status: asks where things stand.
- image: wants a single picture made now, not a full short ("generate an image of...", "make me a thumbnail"). prompt = a vivid, detailed image description in English.
- study: wants the bot to go research, watch, study or learn what makes videos good (techniques, styles, hooks, art, captions) and get better. topic = the niche or focus they named, or "".
- ideas: wants topic suggestions ("what should I make?", "give me ideas", "anything trending?").
- chat: anything else. reply = a short, friendly answer (max 2 sentences) that uses the context.
Words like "redo", "again", "it", "that one", "continue" refer to existing work and are never a new topic.
Never claim you are researching, watching, rendering or doing anything unless the intent you return does it; for anything you cannot do, say so plainly. Background renders run on their own on another machine. Never tell the user to wait for one: act on the new message right away.`;

const DIRECTOR = `You are also the director: for every beat choose the tool that should make its visual.
- "flux": free photo-style or illustrated still (default for most beats).
- "pixellab": pixel-art still. Use only when the visual style is pixel art / retro game, or the beat is about games or 8-bit nostalgia.
- "stock" (real footage, free): a real stock video clip from Pixabay. Use for at most 3 beats that show real-world things (places, cities, nature, people at work, machines, crowds, everyday objects) where real motion beats an illustration. Never for named real people, brands, logos, specific news events or anything with readable text. Add "query": 2-4 plain English words to search for (for example "city traffic night"). Still give an image_prompt as the fallback picture.
- "higgsfield" (runs on Hugging Face, free): a 4-second AI motion clip made from the beat's still. Use for at most %MAX% hero beats where movement adds real impact (the hook, the payoff). Add "motion": one sentence describing the camera move and action. Use "still": "pixellab" if that beat is pixel art.
- "graphic": an animated motion graphic drawn in code (no image), like a news explainer. %GFXRULE% Every number must come from the research and appear in the narration of that beat. No emojis anywhere in a graphic. Add "graphic" as exactly one of:
${SX.GRAPHIC_DOCS}
  Still write an image_prompt for graphic beats (used as a backup).
%OFF%`;

// ---------- Studio steps ----------
const pitchText = (p, src) =>
  `🎬 Pitch: ${p.title}\n\n🪝 Hook: "${p.hook}"\n\n🎯 Angle: ${p.angle}\n\n📌 Facts it uses:\n${(p.key_facts || []).map((f) => '• ' + f).join('\n')}\n\n` +
  (p.style ? `🎬 Style: ${styleName(p)}${p.style_reason ? ` (${p.style_reason})` : ''}\n` : '') +
  `🎨 Look: ${p.visual_style}\n⏱️ About ${(p.length_seconds || 45) >= 90 ? Math.round((p.length_seconds || 45) / 6) / 10 + ' minutes' : (p.length_seconds || 45) + ' seconds'}${p.format ? `, ${FORMAT_LABEL[p.format] || p.format}` : ''}, ${p.music} music` +
  ((src || []).length ? `\n\n🔎 Sources:\n${src.map((x) => '• ' + (x.title || x.url)).join('\n')}` : '') + `\n\nTap a button, or tell me what to change.`;

const ICON = { flux: '🖼️', pixellab: '👾', higgsfield: '🎥', stock: '🎞️', graphic: '📊', scene: '🎭' };
const styleName = (p) => (p?.style && (SX.RECIPES[p.style]?.label || p.style)) || '';
const gfxLine = (g) => g.type === 'counter' ? `counter ${g.prefix || ''}${g.value}${g.suffix || ''} ${g.label || ''}`
  : g.type === 'bars' ? `bars ${g.items.map((i) => `${i.label} ${g.prefix || ''}${i.value}${g.suffix || ''}`).join(' vs ')}`
  : g.type === 'line' ? `line chart ${g.series.map((x) => x.label).join(' vs ')} ${g.title || ''}`
  : g.type === 'list' ? `list: ${g.items.join(' / ')}` : g.type === 'terminal' ? `terminal: ${g.lines.map((l) => l.text).join(' | ')}` : g.type === 'title' ? `title "${g.text}"` : SX.gfxLine2(g);

// Keep only graphics Remotion can draw; anything malformed falls back to a normal image.
function cleanGraphic(g) {
  if (!g || typeof g !== 'object') return null;
  const num = (v) => (typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, '')));
  const str = (v, n) => SX.stripEmoji(v).slice(0, n);
  const base = { prefix: str(g.prefix, 4), suffix: str(g.suffix, 6) };
  if (g.type === 'counter' && isFinite(num(g.value))) return { type: 'counter', value: num(g.value), ...base, label: str(g.label, 40) };
  if (g.type === 'bars' && Array.isArray(g.items)) {
    const items = g.items.map((i) => ({ label: str(i.label, 22), value: num(i.value) })).filter((i) => i.label && isFinite(i.value)).slice(0, 5);
    if (items.length >= 2) return { type: 'bars', title: str(g.title, 40), ...base, items };
  }
  if (g.type === 'line' && Array.isArray(g.series)) {
    const series = g.series.map((x) => ({ label: str(x.label, 14), values: (x.values || []).map(num).filter(isFinite).slice(0, 24) })).filter((x) => x.values.length >= 2).slice(0, 3);
    if (series.length) return { type: 'line', title: str(g.title, 40), ...base, x_labels: (g.x_labels || []).map((x) => str(x, 14)).slice(0, 12), series };
  }
  if (g.type === 'list' && Array.isArray(g.items)) {
    const items = g.items.map((x) => str(x, 40)).filter(Boolean).slice(0, 4);
    if (items.length >= 2) return { type: 'list', title: str(g.title, 40), items };
  }
  if (g.type === 'terminal' && Array.isArray(g.lines)) {
    const KINDS = ['cmd', 'out', 'dim', 'warn', 'err', 'ok', 'path'];
    const lines = g.lines.map((x) => ({ kind: KINDS.includes(x && x.kind) ? x.kind : 'out', text: str(x && x.text, 42) })).filter((x) => x.text).slice(0, 7);
    if (lines.length >= 2) return { type: 'terminal', title: str(g.title, 30), lines };
  }
  if (g.type === 'title' && g.text) return { type: 'title', text: str(g.text, 40), sub: str(g.sub, 50) };
  return SX.cleanGraphic2(g);
}
function scriptText(sc) {
  const lines = [`📝 Script: ${sc.title}\n`];
  sc.beats.forEach((b, i) => lines.push(`${i + 1}. ${b.narration}\n   ${ICON[b.tool] || '🖼️'} ${b.tool || 'flux'}: ${(b.scene ? SX.sceneLine(b.scene) : b.graphic ? gfxLine(b.graphic) : b.motion || b.query || b.image_prompt || '').slice(0, 110)}`));
  const words = sc.beats.reduce((n, b) => n + b.narration.split(/\s+/).length, 0);
  const n = (t) => sc.beats.filter((b) => b.tool === t).length;
  const paid = [n('higgsfield') && `${n('higgsfield')} Hugging Face motion clip${n('higgsfield') > 1 ? 's' : ''} (free)`, n('pixellab') && `${n('pixellab')} PixelLab image${n('pixellab') > 1 ? 's' : ''} (about $${(n('pixellab') * 0.01).toFixed(2)})`].filter(Boolean);
  lines.push(`\n✅ ${(sc.fact_check || []).length} claims checked against the research. ≈ ${Math.round(words / 2.5)} seconds.`);
  lines.push(paid.length ? `💳 Paid tools: ${paid.join(', ')}. Approving the script approves this spend.` : '💳 No paid tools: everything here is free.');
  lines.push('Approve to render, or tell me what to change (e.g. "no motion clips").');
  return lines.join('\n');
}

// Words that describe HOW to make the video (style, length, shape) are not the subject: keep them out of research.
const cleanTopic = (t) => String(t || '').replace(/\b(create|make|do|produce|generate)\b( me)?( an?| another)?/gi, ' ')
  .replace(/\b(in |with )?(a |an )?(stop[\s-]?motion|documentary|docu|motion[\s-]?graphics?|cinematic|anime|vhs|retro|vlog|kinetic|explainer|blueprint)( style| styled| animation| video| graphics)?\b/gi, ' ')
  .replace(/\blike [A-Z][\w']+\b|\b(do(ne)?( it)?|it) (as )?an? \d+(\.\d+)? ?(min(ute)?s?|seconds?)( long)?( video)?( for (youtube|tiktok|shorts))?\b|\b\d+(\.\d+)? ?(min(ute)?s?|seconds?)( long)?\b|\bfor (youtube|tiktok|instagram|reels|shorts)\b|\b(do )?the graphics( in)?\b|\bstyle\b|\bvideo\b/gi, ' ')
  .replace(/\s{2,}/g, ' ').replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '').replace(/^(of|about|on|showing)\s+/i, '').trim() || String(t || '').trim();

async function startPitch(chat, s, topic, feedback = '', job = null) {
  if (!feedback) {
    // A new video: read format / length / style from the request itself (they beat the saved settings for this job).
    s.job = { ...SX.parseJob(topic), ...(job || {}) };
    if (!s.job.style && s.settings?.recipe && SX.RECIPES[s.settings.recipe]) s.job.style = s.settings.recipe;
    s.job.research = s.job.research || SX.researchMode(topic, s.job.style);
    const clean = cleanTopic(topic);
    if (clean.length >= 4) topic = clean;
  } else s.job = { ...(s.job || {}), ...SX.parseJob(feedback), ...(job || {}) };
  s.working = { step: 'pitch', topic, feedback, title: topic };
  const jl = SX.jobLabel(s.job || {});
  await send(chat, feedback ? '🔁 Reworking the pitch...' : `${s.job?.research === 'none' ? '✍️ Shaping your story' : '🔎 Researching'} "${topic.slice(0, 80)}"${s.job?.research === 'none' ? ' (no research, only what you told me)...' : ' so every fact is real...'}${jl ? `\n🎬 As asked: ${jl}` : ''}`);
  await typing(chat);
  const [rs, mem] = await Promise.all([
    feedback && s.topic === topic && s.research?.text ? s.research : s.job?.research === 'none' ? { text: '', sources: [] } : research(topic),
    hive('recall', { query: topic + ' ' + feedback }),
  ]);
  s.memory = hiveText(mem);
  const learned = s.job?.style ? null : activeLearned(s); // a look named in the request beats the saved one
  const msgs = [{ role: 'system', content: pitchPrompt(s.job || {}, learned, (s.recent_styles || []).slice(-3)) }, { role: 'user', content: `Topic: ${topic}\n\nRESEARCH:\n${rs.text || (s.job?.research === 'none' ? "(no research: this is the user's own story or experience. Use only what they said; add no outside facts, numbers or names.)" : '(search unavailable: use only widely known, verifiable facts)')}${s.memory ? '\n\n' + s.memory : ''}${s.playbook ? '\n\nPRODUCER PLAYBOOK (learned from top videos; follow it):\n' + s.playbook : ''}` }];
  if (feedback && s.pitch) msgs.push({ role: 'user', content: `Previous pitch: ${JSON.stringify(s.pitch)}\nChange requested: ${feedback}` });
  const p = await llm(msgs, 0.8);
  p.music = MUSIC.includes(p.music) ? p.music : 'docu-pluck';
  p.accent = ACCENTS[p.accent] ? p.accent : 'gold';
  const jb = s.job || {};
  p.style = learned ? learned.name : jb.style || (SX.RECIPES[p.style] ? p.style : 'bold-pop');
  if (jb.length) p.length_seconds = jb.length;
  p.length_seconds = Math.max(15, Math.min(600, Number(p.length_seconds) || 45));
  if (p.style === 'what-if') p.length_seconds = SX.whatifPlan(p.length_seconds).length;
  p.format = jb.format || (learned && !s.settings?.format ? learned.format : '') || (p.length_seconds > 90 && !s.settings?.format ? 'landscape' : '') || (SX.RECIPES[p.style]?.format && !s.settings?.format ? SX.RECIPES[p.style].format : '') || fmtOf(s.settings);
  if (!FORMATS[p.format]) p.format = 'vertical';
  if (learned && MUSIC.includes(learned.music)) p.music = learned.music;
  Object.assign(s, { stage: 'pitch', topic, research: rs, pitch: p, script: null, working: null });
  remember(s, 'bot', `Pitched "${p.title}": ${p.hook}`);
  await save(s);
  await send(chat, pitchText(p, rs.sources), PITCH_BUTTONS);
  if (!feedback && s.settings?.deep !== false && s.deep?.topic !== topic && !['none', 'light'].includes(s.job?.research)) {
    const ok = await askBrowserBot(chat, { purpose: 'topic', topic, angle: p.hook || p.title || '' });
    s.deep = ok ? { topic, status: 'running', at: Date.now() } : null;
    await save(s);
    if (ok) await send(chat, '🌐 Your browser bot is reading the sources properly now (2 to 5 min). Its facts go into the script.');
  }
}

// Long videos: one call writes the outline, then each chapter's beats are written in parallel (fits the 60s limit).
async function longScript(msgs, pl) {
  const outline = await llm([...msgs, { role: 'user', content: `First return ONLY the outline as JSON: {"title": "...", "chapters": [{"title": "2-5 words", "beats": number of beats, "covers": "what this part says, 1-2 sentences, with the facts it uses"}]} with ${pl.chapters + 1} parts (part 1 is the cold open with the hook) and ${pl.beats} beats in total.` }], 0.6, false);
  const parts = (outline.chapters || []).slice(0, 8);
  if (parts.length < 2) return llm(msgs, 0.7);
  const plan = parts.map((c, i) => `${i + 1}. ${c.title} (${c.beats} beats): ${c.covers}`).join('\n');
  const outs = await Promise.all(parts.map((c, i) => llm([...msgs, { role: 'user', content: `OUTLINE of the whole video:\n${plan}\n\nWrite ONLY part ${i + 1} ("${c.title}"): exactly ${Math.max(2, Math.round(Number(c.beats) || 4))} beats, same JSON shape {"beats": [...], "fact_check": [...]}. ${i === 0 ? 'Beat 1 is the hook.' : 'Open with a line that re-hooks; do not repeat earlier parts.'}${i === parts.length - 1 ? ' End on the short repeatable closing line.' : ''}` }], 0.7, false).catch(() => ({ beats: [] }))));
  const beats = [], chapters = [], fact_check = [];
  outs.forEach((o, i) => { if (i && (o.beats || []).length) chapters.push({ title: parts[i].title, beat: beats.length }); beats.push(...(o.beats || [])); fact_check.push(...(o.fact_check || [])); });
  return { title: outline.title, beats, chapters, fact_check };
}

// Rhythm numbers measured by tools/style_metrics.py (shot lengths, hook, tempo, beat alignment, motion).
// A beat only counts as real when the cuts clearly follow it AND the pulse is strong enough to trust.
function snapsToBeat(st) {
  const m = (st && st.metrics) || {};
  return !!(m.cuts_snap_to_beat && m.tempo_bpm && (m.tempo_confidence || 0) >= 0.25);
}
function rhythmFacts(st) {
  const m = (st && st.metrics) || {};
  return [
    m.shot_s_median && `typical shot ${m.shot_s_median}s`,
    m.hook_s != null && m.hook_s <= 6 && `first cut at ${m.hook_s}s`,
    m.shot_spread_label && m.shot_spread_label !== 'too few cuts' && `${m.shot_spread_label} shot lengths`,
    snapsToBeat(st) && `cuts land on the beat (${Math.round(m.tempo_bpm)} BPM)`,
    m.motion_level && `${m.motion_level} motion`,
    st && st.samples > 1 && `merged from ${st.samples} videos`,
  ];
}
function rhythmNote(st) {
  const m = (st && st.metrics) || {};
  const bits = [];
  if (m.shot_s_median) {
    const lo = Math.max(2, m.shot_s_p10 || 2), hi = Math.max(lo, Math.min(9, m.shot_s_p90 || 9));
    const steady = m.shot_spread_label === 'steady';
    bits.push(`the reference's shots are typically ${m.shot_s_median}s${steady ? ', very even, so keep beats about the same length' : ` (most between ${lo}s and ${hi}s), so vary beat lengths the same way`}`);
  }
  if (m.hook_s != null && m.hook_s <= 6) bits.push(`its first cut comes by ${m.hook_s}s, so make beat 1 a short, punchy hook`);
  if (m.motion_level) bits.push(`motion is ${m.motion_level}`);
  return bits.length ? `\nRhythm measured from the reference: ${bits.join('; ')}. The beat count above still applies.` : '';
}

// A style learned from a reference video (saved by tools/learn_style.py through ?event=style).
function activeLearned(s, name) {
  const n = name || s.settings?.style;
  const st = n && (s.styles || {})[n];
  return st && st.style_tokens ? st : null;
}

const VIDEO_URL = /https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be|tiktok\.com|vm\.tiktok\.com|instagram\.com|vimeo\.com|x\.com|twitter\.com|facebook\.com|fb\.watch|dailymotion\.com)\/\S+/i;
// Script craft rules (from the studio scripting playbook). The learned STYLE block, when present, wins on length, pacing and tone.
function craftBlock(pl) {
  const long = ((pl && pl.length) || 0) >= 90;
  return `

SCRIPT CRAFT (how to write each line. The STYLE block, when there is one, decides beat length, beat count, pacing, tone and graphic mix, and the JSON format above stays exactly as specified):
- Hook: beat 1 starts with the hook itself. No greeting, no "welcome", no throat-clearing. Make it a specific claim, number or question that promises what the video pays off: a surprising action with a number, a result first, a common mistake and its cost, or dropping into the middle of the moment.
- Spoken words: contractions, second person, active voice, short sentences. Vary the sentence lengths so the voice never goes monotone.
- Connect beats with BUT and THEREFORE, never "and then". Every beat adds a problem, a twist or a consequence.
- Ramp the difficulty: context first, then the simple idea, then the advanced one. No jargon the viewer has not been given.
- Hint, do not dump: open one question early and answer it later, so the viewer waits for the payoff.
- One idea per video. Land one reframe that changes how the viewer sees the problem${long ? ', and a second, practical one they can use' : ''}.${long ? ' Put the first by about 40% of the video and the second by about 75%. Re-hook about every 30 to 60 seconds with a question, a but-turn or a change of scene.' : ''}
- Proof: use only specifics that appear in the research (numbers, dates, names). Never invent a statistic, quote, result or testimonial. If a fact is not in the research, leave it out.
- Ending: pay off the promise first. End on the payoff, a callback to the hook, or a question that leads to the next video. Never end on "thanks for watching". No rage bait, no fake urgency, no guilt-trip asks.`;
}

async function learnStyle(chat, s, source, text = '') {
  const named = String(text).match(/\b(?:call it|name it|named|save (?:it )?as)\s+["']?([\w -]{2,30})/i);
  const host = source.startsWith('tg:') ? 'upload' : (source.match(/\/\/(?:www\.)?([a-z]+)/i) || [])[1] || 'ref';
  let name = (named ? named[1] : `${host}-${Object.keys(s.styles || {}).length + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  // "add this to <style>" folds the new video into a style you already learned (several videos, one creator).
  const wantsMerge = /\b(?:add (?:it |this |that )?to|merge (?:it |this |that )?(?:into|with)|learn ?add)\b/i.test(text);
  const lowText = String(text).toLowerCase();
  const prevName = wantsMerge ? (Object.keys(s.styles || {}).find((k) => lowText.includes(k)) || ((s.settings && s.settings.style && (s.styles || {})[s.settings.style]) ? s.settings.style : '')) : '';
  const prev = prevName ? s.styles[prevName] : null;
  const merging = !!(prev && JSON.stringify(prev).length < 55000);
  if (merging) name = prevName;
  const r = await gh('dispatches', { method: 'POST', body: JSON.stringify({ event_type: 'learn-style', client_payload: { source, name, chat_id: chat, app_url: APP, ...(merging ? { prev_style: prev } : {}) } }) });
  if (r.ok && merging) await send(chat, `➕ Adding this video to your style "${prevName}" (${(prev.samples || 1) + 1} videos).`);
  s.learning = r.ok ? { name, source, at: Date.now() } : null;
  remember(s, 'bot', r.ok ? `Studying a reference video as style "${name}"` : 'Could not start style learning');
  await save(s);
  return send(chat, r.ok ? `🔬 Got it. I'm studying that video now (about 2 to 5 minutes): cut rhythm, camera motion, frame rate feel, colours, captions, graphics mix. I'll save it as the style "${name}" and use it for your next videos.` : `⚠️ GitHub refused the style job (${r.status}). Check that STUDIO_TOKEN can run workflows on ${REPO} and that learn-style.yml is pushed.`);
}
// learn_style.py posts the finished recipe here.
async function styleBack(req, res) {
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const st = b.style;
  if (!st || !st.name || !st.style_tokens) return res.status(400).json({ error: 'style missing' });
  const s = await load();
  const chat = ALLOWED || s.chat;
  s.styles = { ...(s.styles || {}), [st.name]: st };
  s.settings = { ...(s.settings || {}), style: st.name };
  s.learning = null;
  await save(s);
  try {
    const g = await hive('kv_get', { key: 'styles' });
    const all = { ...((g && g.value && g.value.styles) || {}), [st.name]: { text: `${st.summary}\n${st.pacing}\n${st.writer_notes}`, recipe: st } };
    await hive('kv_put', { key: 'styles', value: { styles: all } });
  } catch (e) {}
  const m = st.metrics || {};
  const facts = [m.cuts_per_min != null && `${m.cuts_per_min} cuts a minute`, m.avg_shot_s && `${m.avg_shot_s}s shots`, m.held_frame_share > 0.35 && m.motion_level !== 'static' && 'held frames (stop-motion feel)', ...rhythmFacts(st), m.aspect].filter(Boolean).join(', ');
  if (chat) await send(chat, `🎨 Learned the style "${st.name}": ${st.summary}\n\n📏 ${!Object.keys(st.metrics || {}).length ? 'No exact measurements: the download was blocked (YouTube often blocks it), so this look is a guess from thumbnails. Send the video as a file for exact numbers.' : (facts || 'measured from the video')}\n🎬 Mode: ${st.mode}, about ${Math.round((st.graphic_ratio || 0) * 100)}% motion graphics, closest look ${st.base}\n\nYour next videos use it. Say "auto style" to let me pick per topic again, or /styles to see them all.`);
  return res.status(200).json({ ok: true });
}

async function writeScript(chat, s, feedback = '') {
  s.working = { step: 'script', feedback, title: s.pitch?.title };
  await send(chat, feedback ? '🔁 Rewriting...' : '✍️ Writing the script, checking every fact and picking a tool for each shot...');
  await typing(chat);
  const set = s.settings || {};
  let styleBlock = '';
  if (set.style) {
    try {
      const g = await hive('kv_get', { key: 'styles' });
      const st = g && g.value && g.value.styles && g.value.styles[set.style];
      if (st && st.text) styleBlock = '\n\nSTYLE TO MATCH ("' + set.style + '", learned from a reference video): copy its editing style (shot rhythm, graphic mix, caption feel, tone) while keeping every fact checked. If the style is mostly diagrams, UI or terminals, use a graphic beat on about every other beat (never two in a row) and write beats of 3 to 5 seconds.\n' + st.text;
    } catch (e) {}
  }
  const p0 = s.pitch || {};
  const learned = activeLearned(s, p0.style);
  const recipe = SX.RECIPES[p0.style] || null;
  const isWI = !learned && p0.style === 'what-if';
  const rmode = s.job?.research || (isWI ? 'light' : 'full');
  const pl = isWI ? SX.whatifPlan(p0.length_seconds) : SX.plan(p0.length_seconds, learned?.beat_seconds || recipe?.beat);
  if (learned) styleBlock = `\n\nSTYLE TO MATCH ("${learned.name}", learned from a reference video): ${learned.summary}\nPacing: ${learned.pacing} About ${learned.beat_seconds}s per beat.${rhythmNote(learned)}\nWriting: ${learned.writer_notes}\nImage style for every image_prompt: ${learned.image_style}`;
  else if (recipe && !isWI) styleBlock += `\n\nSTYLE RECIPE "${p0.style}" (${recipe.label}). Every image_prompt is in this art style: ${p0.visual_style || recipe.image}.`;
  const off = [set.graphics === false && 'Graphics are OFF: never use "graphic".', set.higgsfield === false && 'Motion clips are OFF: never use "higgsfield".', set.pixellab === false && 'PixelLab is OFF: never use it.'].filter(Boolean).join(' ');
  const gfxRule = set.graphics === false ? 'Graphics are off.' : SX.graphicRule(p0.style, learned);
  const director = isWI ? SX.whatifDirector(off, rmode) : DIRECTOR.replace('%MAX%', String(set.max_motion ?? 2)).replace('%OFF%', off).replace('%GFXRULE%', gfxRule);
  const pfmt = FORMATS[p0.format] ? p0.format : fmtOf(set);
  const fmt = { landscape: '\nFORMAT: landscape 16:9 (a normal YouTube video). Write wide, cinematic image prompts.',
    square: '\nFORMAT: square 1:1. Image prompts: centered subject with room around it.',
    portrait: '\nFORMAT: portrait 4:5 feed post. Image prompts: vertical framing, subject centered.' }[pfmt] || '\nFORMAT: vertical 9:16 Short. Image prompts: vertical framing, subject centered.';
  const sizing = `\nLENGTH: about ${pl.length} seconds = about ${pl.words} words in ${pl.min} to ${pl.max} beats (about ${pl.beats}).` +
    (pl.chapters ? ` Long-form: also return "chapters": [{"title": "2-5 words", "beat": index of the beat (0-based) where the chapter starts}] with ${pl.chapters} chapters after the opening (never beat 0). Each chapter opens with a fresh visual and a line that re-hooks.` : '');
  const scriptBase = isWI ? SX.whatifScript(SCRIPT, RULES, rmode) : rmode === 'none' ? SX.storyScript(SCRIPT) : SCRIPT;
  const system = scriptBase.replace('as 6 to 9 beats', `as ${pl.min} to ${pl.max} beats`).replace('so total words\nshould match the length (45 seconds = about 110 words)', `so total words\nshould match the length (${pl.length} seconds = about ${pl.words} words)`) + sizing + (isWI ? '' : fmt) + '\n\n' + director + (isWI ? '' : craftBlock(pl));
  const msgs = [{ role: 'system', content: system }, { role: 'user', content: `Approved pitch: ${JSON.stringify(s.pitch)}\n\nRESEARCH:\n${s.research?.text || ''}${s.memory ? '\n\n' + s.memory : ''}${s.playbook ? '\n\nPRODUCER PLAYBOOK (learned from top videos; follow it):\n' + s.playbook : ''}${styleBlock}` }];
  if (feedback && s.script) msgs.push({ role: 'user', content: `Previous script: ${JSON.stringify(s.script)}\nChange requested: ${feedback}` });
  let sc;
  for (let i = 0; i < 2; i++) {
    if (i && Date.now() - T0 > 30000) break; // stay inside the webhook's time limit
    sc = pl.beats > 16 && !feedback ? await longScript(msgs, pl) : await llm(msgs, 0.7);
    const text = (sc.beats || []).map((b) => b.narration).join('\n');
    const bad = [...text.matchAll(BANNED)].map((m) => m[0]);
    const unsupported = rmode === 'full' ? (sc.fact_check || []).filter((c) => c.supported === false).map((c) => c.claim) : [];
    if (!bad.length && !unsupported.length && sc.beats?.length >= 4) break;
    msgs.push({ role: 'user', content: `Fix this and keep ${pl.min}-${pl.max} beats. Banned phrases: ${bad.join(', ') || 'none'}. Remove unsupported claims: ${unsupported.join(' | ') || 'none'}.` });
  }
  // Enforce the tool rules whatever the model said.
  if (isWI) {
    for (const b of sc.beats) {
      b.narration = SX.stripEmoji(b.narration);
      b.scene = SX.cleanScene(b.scene) || { pack: 'whatif', scene: 'demo', shot: 'medium', room: 'desk', mood: 'dusk' };
      b.tool = 'scene'; b.image_prompt = '';
      delete b.graphic; delete b.motion; delete b.query; delete b.still;
    }
    SX.finishWhatIfBeats(sc.beats);
  }
  let motion = 0, stockN = 0;
  const maxStock = set.max_stock ?? (pl.length > 90 ? Math.ceil(pl.beats / 4) : 3);
  for (const b of sc.beats) {
    b.narration = SX.stripEmoji(b.narration);
    if (isWI && b.tool === 'scene') continue;
    if (b.tool === 'graphic' || b.graphic) {
      b.graphic = set.graphics === false ? null : cleanGraphic(b.graphic);
      b.tool = b.graphic ? 'graphic' : 'flux';
      if (!b.graphic) delete b.graphic;
      continue;
    }
    if (!['flux', 'pixellab', 'higgsfield', 'stock'].includes(b.tool)) b.tool = 'flux';
    if (b.tool === 'pixellab' && set.pixellab === false) b.tool = 'flux';
    if (b.tool === 'higgsfield' && (set.higgsfield === false || ++motion > (set.max_motion ?? 2))) b.tool = 'flux';
    if (b.tool === 'stock' && (set.stock === false || !String(b.query || '').trim() || ++stockN > maxStock)) b.tool = 'flux';
  }
  sc.chapters = (Array.isArray(sc.chapters) ? sc.chapters : []).map((c) => ({ title: SX.stripEmoji(c?.title).slice(0, 48), beat: Math.round(Number(c?.beat)) }))
    .filter((c) => c.title && c.beat > 0 && c.beat < sc.beats.length).slice(0, 8);
  Object.assign(s, { stage: 'script', script: sc, working: null });
  remember(s, 'bot', `Wrote the script for "${sc.title}"`);
  await save(s);
  await send(chat, scriptText(sc), SCRIPT_BUTTONS);
}

async function render(chat, s, opts = {}) {
  const p = s.pitch, sc = s.script;
  const learned = activeLearned(s, p.style);
  const recipe = learned ? (SX.RECIPES[learned.base] ? learned.base : 'bold-pop') : (SX.RECIPES[p.style] ? p.style : '');
  const pfmt = FORMATS[p.format] ? p.format : fmtOf(s.settings);
  const fps = (learned?.style_tokens?.fx?.hold || 1) > 1 || recipe === 'stop-motion' ? 24 : 30;
  const spec = {
    title: sc.title || p.title, hook: p.hook, style: p.visual_style || '', music: p.music, accent: ACCENTS[p.accent] || '#FFD43B',
    voice: process.env.STUDIO_VOICE || 'en-US-AndrewMultilingualNeural', allow_plain: !!opts.plain, gemini_images: s.settings?.gemini_images === true,
    format: pfmt === 'landscape' ? 'landscape' : 'vertical', canvas: FORMATS[pfmt], fps, topic: s.topic || '',
    ...(recipe ? { style_preset: SX.RECIPES[recipe]?.render || recipe } : {}), ...(learned ? { style_tokens: learned.style_tokens, learned_style: learned.name } : {}),
    ...(sc.chapters?.length ? { chapters: sc.chapters } : {}),
    project_id: `${slug(sc.title || p.title)}-${Date.now().toString(36)}`,
    ...(s.settings?.caption_style ? { caption_style: s.settings.caption_style } : {}), ...(!recipe && s.settings?.style_preset ? { style_preset: s.settings.style_preset } : {}),
    beats: sc.beats.map((b) => ({ narration: b.narration, image_prompt: b.image_prompt, tool: b.tool || 'flux', motion: b.motion, still: b.still, query: b.query, ...(b.graphic ? { graphic: b.graphic } : {}), ...(b.scene ? { scene: b.scene } : {}) })),
  };
  const r = await gh('dispatches', { method: 'POST', body: JSON.stringify({ event_type: 'make-short', client_payload: { chat_id: chat, app_url: APP, spec } }) });
  if (!r.ok) return send(chat, `⚠️ GitHub refused the render (${r.status}). Check that STUDIO_TOKEN can write to ${REPO}.`);
  const project = { id: spec.project_id, canvas: spec.canvas, title: spec.title, topic: s.topic, pitch: p, script: sc, research: { text: (s.research?.text || '').slice(0, 3000), sources: s.research?.sources || [] }, at: Date.now() };
  s.projects = [project, ...(s.projects || []).filter((x) => x.title !== project.title)].slice(0, 8);
  // The render runs by itself on GitHub, so the studio is free straight away for the next idea, script or image.
  s.renders = [...(s.renders || []).filter((x) => Date.now() - x.at < 25 * 60e3), { title: spec.title, at: Date.now(), project: spec.project_id }];
  s.current_project = spec.project_id;
  s.pending_edit = null;
  s.recent_styles = [...(s.recent_styles || []), p.style || recipe || 'bold-pop'].slice(-5);
  s.job = null;
  Object.assign(s, { stage: 'idle', pitch: null, script: null, working: null, lastRenderAuto: !!s.resumeAuto });
  remember(s, 'bot', `Rendering "${spec.title}"`);
  await save(s);
  await hive('add', { items: [
    { kind: 'event', text: `Shorts Studio made a short: "${spec.title}" (topic: ${s.topic}).`, tags: ['short', 'video'] },
    { kind: 'interest', text: `The user approved a short about ${s.topic}.`, tags: ['short', 'topic'] },
  ] });
  const mins = sc.beats.length > 16 ? '20 to 40' : '8 to 15';
  await send(chat, `🎬 Rendering "${spec.title}" now${p.style ? ` in the ${styleName(p)} style` : ''}, ${spec.canvas}. Each shot goes to its tool, then everything is edited together. It lands here in about ${mins} minutes, and in your Studio. Meanwhile I'm free: send another topic, an image idea, anything.`, appButton());
}

// ---------- Saved projects: re-render with a JSON patch (no new pitch/script; only changed assets are remade) ----------
async function rerender(chat, s, patch, message, label) {
  const proj = currentProject(s);
  if (!proj) { await save(s); return send(chat, "I don't have a saved project yet. Shorts made from now on are saved as editable projects."); }
  // Same queue as chat edits, so /reformat and /captions show up in /history and can be undone.
  return dispatchEdit(chat, s, { id: newEditId(), project_id: proj.id, patch, message, summary: `"${proj.title}" ${label}`,
    detail: '♻️ Same voice and pictures, nothing regenerated, so it is quick.', at: Date.now() }, proj);
}

// ---------- Engine step 2: chat re-edit agent ----------
// Any message about the current project ("swap scene 3 for a rocket launch", "bigger yellow captions", "make it 16:9")
// -> ONE edit-model call -> JSON patch on the saved timeline -> sanitised + schema-checked here -> short summary with
// Apply/Cancel (or straight to render when the message starts with "just") -> render-project dispatch with the queue of
// unconfirmed edits (ids), so a newer run never loses an older edit. The renderer re-voices only changed lines and
// repaints only changed prompts; each applied edit is a new version (/history, /undo, /restore <n>).
const EDIT_TTL = 45 * 60e3;
let T0 = Date.now();
const left = () => 56000 - (Date.now() - T0);
let SCHEMA_CACHE = null;

async function ghRaw(path) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    signal: AbortSignal.timeout(9000),
    headers: { Authorization: 'Bearer ' + GH, Accept: 'application/vnd.github.raw+json', 'User-Agent': 'shorts-studio-bot' },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ${r.status} reading ${path}`);
  return r.text();
}
async function timelineSchema() {
  if (SCHEMA_CACHE) return SCHEMA_CACHE;
  try { SCHEMA_CACHE = JSON.parse(await ghRaw('timeline/timeline.schema.json') || 'null'); } catch (e) { SCHEMA_CACHE = null; }
  return SCHEMA_CACHE;
}
const parseLog = (txt) => String(txt || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
const newEditId = () => 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

function currentProject(s) {
  const list = (s.projects || []).filter((p) => p.id);
  return list.find((p) => p.id === s.current_project) || list[0] || null;
}
const inFlight = (s, pid) => (s.renders || []).find((x) => x.project === pid && Date.now() - x.at < 25 * 60e3);

// The project as the user sees it: the repo's timeline plus edits sent but not rendered yet.
async function loadProject(s, pid) {
  const [tl, logTxt, schema] = await Promise.all([ghRaw(`media/projects/${pid}/timeline.json`), ghRaw(`media/projects/${pid}/history/log.jsonl`), timelineSchema()]);
  if (!tl) return null;
  const repo = JSON.parse(tl);
  const log = parseLog(logTxt);
  const applied = new Set(log.map((h) => h.edit_id).filter(Boolean));
  s.edits = (s.edits || []).filter((e) => !applied.has(e.id) && Date.now() - e.at < EDIT_TTL);
  const queued = s.edits.filter((e) => e.project_id === pid);
  let view = repo;
  for (const e of queued) {
    try {
      if (e.revert != null) { const snap = await ghRaw(`media/projects/${pid}/history/r${e.revert}.json`); if (snap) view = { ...JSON.parse(snap), rev: view.rev }; }
      else view = TLX.normalize(TLX.jsonPatch(view, e.patch));
      view = { ...view, rev: (view.rev || 0) + 1 };
    } catch (err) { console.log('queued edit no longer applies', e.id, err.message); }
  }
  return { repo, view, log, versions: TLX.versions(log), queued, schema };
}

async function appliedIds(pid) {
  try { return new Set(parseLog(await ghRaw(`media/projects/${pid}/history/log.jsonl`)).map((h) => h.edit_id).filter(Boolean)); }
  catch (e) { return new Set(); }
}

// One model call, sized to what is left of this 60s function: smart model first if there is room, then the fast chain.
async function llmBudget(messages, temperature = 0.2) {
  const errors = [];
  const tries = [];
  if (left() > 30000) tries.push([{ model: 'smart' }, Math.min(26000, left() - 15000)]);
  tries.push([{}, null]);
  for (const [extra, cap] of tries) {
    const ms = cap ?? left() - 4000;
    if (ms < 4000) { errors.push('no time left'); break; }
    try {
      const d = await proxy('/api/v1/chat/completions', { messages, temperature, response_format: { type: 'json_object' }, ...extra }, ms);
      let t = (d.choices?.[0]?.message?.content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      if (!t.startsWith('{')) { const a = t.indexOf('{'), b = t.lastIndexOf('}'); t = t.slice(a, b + 1); }
      return JSON.parse(t);
    } catch (e) { errors.push(e.name === 'TimeoutError' ? `llm timeout ${Math.round(ms / 1000)}s` : e.message); }
  }
  throw new Error(errors.join(' / '));
}

const EDITOR = `You are the video editor of a Shorts Studio. The user wants to change a video that already exists.
Turn the request into a JSON patch on its timeline. Scenes are numbered 1..N for the user; each has an id (@v1...). "The hook" = scene 1, "the ending" = the last scene.
Return JSON only:
{"kind": "edit" | "question" | "not_edit",
 "summary": "one short line for the user, in plain words, using scene numbers (e.g. 'Scene 3 now shows a rocket launch at dawn')",
 "message": "version note, max 8 words",
 "patch": [RFC 6902 ops],
 "reply": "only for question/not_edit: a short answer"}
Patch rules:
- Address clips by id: "/tracks/visuals/@v3/gen/prompt". Only inserting uses an index: {"op":"add","path":"/tracks/visuals/2","value":{...}} (2 = becomes scene 3) or "/tracks/visuals/-" (at the end).
- Ops: add, remove, replace, move, plus "merge" (shallow-merge an object: {"op":"merge","path":"/style/caption","value":{"size":120}}). Use merge or add for keys that do not exist yet.
- Never write: id, src, hash, words, segments, start, end, rev, meta (timing, voice files and pictures are remade automatically).
- New picture for a scene: replace /tracks/visuals/@vN/gen/prompt with a concrete, vivid scene (no text, no logos, no real faces), in the project's image style. If that scene is a graphic, replace the whole clip instead: {"op":"merge","path":"/tracks/visuals/@vN","value":{"kind":"image","gen":{"tool":"flux","prompt":"..."}}} and remove /tracks/visuals/@vN/graphic.
- Change what is said: replace /tracks/visuals/@vN/narration (1-2 short spoken sentences). Keep facts true; never invent statistics. Keep other scenes' words unless asked (only changed lines are re-recorded).
- Cut a scene: {"op":"remove","path":"/tracks/visuals/@vN"}. Add a scene: add {"kind":"image","narration":"...","gen":{"tool":"flux","prompt":"..."}} (or kind "graphic" with "graphic": any of ${SX.GRAPHIC_TYPES.join('/')}, same JSON shapes the director uses).
- Scene clips (kind "scene", the What If cartoon): change one by merging fields into its scene object, e.g. {"op":"merge","path":"/tracks/visuals/@vN/scene","value":{"shot":"close","pose":"shock"}}. Allowed values: ${SX.whatifDocs()}. Add one: {"op":"add","path":"/tracks/visuals/-","value":{"kind":"scene","narration":"...","scene":{"pack":"whatif","scene":"demo","shot":"medium","room":"desk"},"gen":{"tool":"scene"}}}. Keep one room and one mood in the whole video.
- Reorder: {"op":"move","from":"/tracks/visuals/@vN","path":"/tracks/visuals/<index>"}.
- Pacing: voice speed /tracks/voice/@vo/gen/rate as "+12%" (faster) or "-10%" (slower), relative to the current rate; also shorter transitions for punchier, longer dissolves for calmer.
- Captions: merge into /style/caption. Keys: preset (bold-pop, karaoke-box, clean, subtitle, neon, word-by-word, none), font, weight, size (px on the 1080 short side; preset defaults: bold-pop 92, karaoke-box 80, clean 64, subtitle 50, neon 128, word-by-word 160; "bigger" = about +30%), color, highlight (active word; default = accent), stroke, background, case (upper|lower|none), position (auto|top|middle|bottom), words_per_group (1-20). "Yellow" = "#FFD43B". Turn captions off: replace /style/caption/preset with "none".
- Fonts: Montserrat, Anton, Bebas Neue, Inter, Poppins, Oswald, Roboto, Playfair Display, Bangers, Space Grotesk, Archivo Black, Lora, DM Serif Display, Permanent Marker, Rubik Mono One.
- Look: /style/transition {"type": cut|fade|dissolve|slide-left|slide-right|slide-up|slide-down|zoom-in|zoom-out|wipe|blur|flash, "duration": seconds}, /style/accent (hex), /style/grade (CSS filter), /style/motion (kenburns|static), /style/progress_bar, /style/vignette; per scene: /tracks/visuals/@vN/transition, motion (auto|zoom-in|zoom-out|pan-left|pan-right|pan-up|pan-down|static), fit (auto|cover|contain|blur-fill).
- Whole look / style recipe ("make it documentary style", "stop motion look"): {"op":"merge","path":"/style","value":{"apply_recipe":"<one of ${SX.RECIPE_NAMES.join(', ')}>"}}. Motion: /style/motion also takes parallax|drift|handheld; texture/stop-motion feel: merge /style/fx {"hold":2,"jitter":5,"texture":"paper|grain|film|vhs|none","letterbox":0.06}; graphics background: /style/backdrop grid|gradient|paper|blueprint|dots|none.
- Music: replace /tracks/music/@m1/gen/name with one of ${JSON.stringify(MUSIC)}; volume /tracks/music/@m1/volume (0.05-0.3). No music: remove the clip.
- Shape: replace /canvas with {"width":W,"height":H,"fps":30}: 16:9 = 1920x1080, 9:16 = 1080x1920, 1:1 = 1080x1080, 4:5 = 1080x1350. Pictures are reframed automatically.
- Title: replace /title and the title overlay text (/tracks/overlays/@title/text) together.
- If a PENDING proposal is shown and the new message refines or adds to it, return ONE combined patch with everything still wanted.
- If the request is unclear about which scene, pick the most likely one and name it in the summary. If it asks about the video (no change), kind = "question". If it is not about editing this video at all, kind = "not_edit".
${RULES}`;

const EDIT_RE = /\b(scenes?|shots?|clips?|hook|ending|intro|outro|opening|captions?|subtitles?|music|song|soundtrack|voice|narrat\w*|pacing|pace|slower|faster|16:9|9:16|1:1|4:5|landscape|vertical|square|portrait|widescreen|fonts?|colou?rs?|transitions?|title|cut|remove|delete|drop|swap|replace|rewrite|reword|bigger|smaller|larger|louder|quieter|punchier|shorter|longer|zoom|yellow|red|blue|green|white|accent)\b/i;
const NEW_SHORT_RE = /\b(make|create|do|start|produce|build|generate)\b.{0,60}\b(short|video|reel|tiktok|documentary|explainer|animation|film|story)\b|^\/short\b|\b(day|daily life) of\b|\bstop[\s-]?motion style\b/i;
const NEW_VIDEO_RE = /^\s*(please\s+)?(make|create|produce|generate|build)\b.{0,80}\b(short|video|reel|tiktok|documentary|explainer|animation|film)\b/i;
const looksLikeEdit = (s, text) => !!currentProject(s) && !NEW_SHORT_RE.test(text) && EDIT_RE.test(text) && !/^\s*(redo|remake|again|start over)\b/i.test(text);

async function editRequest(chat, s, text, direct = false) {
  const proj = currentProject(s);
  if (!proj) { await save(s); return send(chat, "There's no saved project to edit yet. Make one with /short <topic>, then just tell me what to change."); }
  await typing(chat);
  const ctx = await loadProject(s, proj.id);
  if (!ctx) {
    await save(s);
    return send(chat, inFlight(s, proj.id) ? `⏳ "${proj.title}" is still being made. As soon as it lands you can change anything in it.` : `I can't find project ${proj.id} in the repo. /project lists the ones I can edit.`);
  }
  const pend = s.pending_edit?.project_id === proj.id ? s.pending_edit : null;
  s.working = { step: 'message', text, title: 'your edit' };
  const d = await llmBudget([{ role: 'system', content: EDITOR }, { role: 'user', content:
    `${TLX.editorView(ctx.view)}\n\n${pend ? `PENDING proposal (not applied yet): ${pend.summary}\nits patch: ${JSON.stringify(pend.patch)}\n\n` : ''}Recent chat:\n${(s.history || []).slice(-6).map((h) => `${h.role}: ${h.text}`).join('\n')}\n\nREQUEST: ${text}` }]);
  s.working = null;
  if (d.kind === 'question' || d.kind === 'not_edit' || !Array.isArray(d.patch) || !d.patch.length) {
    const reply = d.reply || (d.kind === 'not_edit' ? "That doesn't sound like a change to the video. Send /short <topic> for a new one, or tell me what to change." : "I couldn't see a change to make there. Try e.g. \"swap scene 3 for a rocket launch\".");
    remember(s, 'bot', reply);
    await save(s);
    return send(chat, reply);
  }
  let ops, neu;
  try {
    ({ ops } = TLX.sanitize(ctx.view, d.patch));
    neu = TLX.normalize(TLX.jsonPatch(ctx.view, ops));
  } catch (e) {
    await save(s);
    return send(chat, `⚠️ I couldn't turn that into a clean edit (${String(e.message).slice(0, 140)}). Say it another way, or name the scene number (/scenes lists them).`);
  }
  const errs = TLX.validate(neu, ctx.schema);
  if (errs.length) { await save(s); return send(chat, `⚠️ That edit would break the video, so I stopped: ${errs.slice(0, 3).join('; ')}`); }
  if (!ops.length) { await save(s); return send(chat, 'Nothing would change with that. /scenes shows what is in the video now.'); }
  const p = TLX.plan(ctx.view, neu);
  const edit = { id: newEditId(), project_id: proj.id, patch: ops, message: String(d.message || d.summary || text).slice(0, 80), summary: String(d.summary || text).slice(0, 300),
    detail: TLX.planText(ctx.view, neu, p), base_rev: ctx.view.rev, at: Date.now() };
  remember(s, 'bot', `Proposed edit to "${proj.title}": ${edit.summary}`);
  LEARN_NEXT = { user: text, bot: `Edited the video: ${edit.summary}` };
  if (direct) return dispatchEdit(chat, s, edit, proj);
  s.pending_edit = edit;
  await save(s);
  return send(chat, `✏️ ${edit.summary}\n\n${edit.detail}\n\nApply it? (Next time start with "just" and I'll apply it straight away.)`,
    { inline_keyboard: [[{ text: '✅ Apply & render', callback_data: 'edit:apply:' + edit.id }], [{ text: '❌ Cancel', callback_data: 'edit:cancel' }]] });
}

async function dispatchEdit(chat, s, edit, proj = null) {
  proj = proj || (s.projects || []).find((x) => x.id === edit.project_id) || { id: edit.project_id, title: edit.project_id };
  const applied = await appliedIds(edit.project_id);
  s.edits = [...(s.edits || []).filter((e) => !applied.has(e.id) && Date.now() - e.at < EDIT_TTL && e.id !== edit.id), { ...edit, at: Date.now() }];
  const queue = s.edits.filter((e) => e.project_id === edit.project_id)
    .map((e) => ({ id: e.id, message: e.message, ...(e.revert != null ? { revert: e.revert } : { patch: e.patch }) }));
  const r = await gh('dispatches', { method: 'POST', body: JSON.stringify({ event_type: 'render-project', client_payload: { chat_id: chat, app_url: APP, project_id: edit.project_id, edits: queue, message: edit.message } }) });
  if (!r.ok) {
    s.edits = s.edits.filter((e) => e.id !== edit.id);
    await save(s);
    return send(chat, `⚠️ GitHub refused the re-render (${r.status}). Check that STUDIO_TOKEN can write to ${REPO}.`);
  }
  if (s.pending_edit?.id === edit.id) s.pending_edit = null;
  s.current_project = edit.project_id;
  s.renders = [...(s.renders || []).filter((x) => Date.now() - x.at < 25 * 60e3), { title: `${proj.title} (${edit.message})`, at: Date.now(), project: edit.project_id }];
  remember(s, 'bot', `Applying edit to "${proj.title}": ${edit.message}`);
  await save(s);
  const ahead = queue.length > 1 ? ` (plus ${queue.length - 1} earlier edit${queue.length > 2 ? 's' : ''} not rendered yet, so nothing gets lost)` : '';
  return send(chat, `🔁 ${edit.revert != null ? edit.summary : 'Applying: ' + edit.summary}${ahead}\n${edit.detail || ''}\nThe new version lands here in about 4 to 10 minutes. Keep the changes coming: /scenes · /history · /undo`);
}

async function applyPending(chat, s, id) {
  const e = s.pending_edit;
  if (!e || (id && e.id !== id)) { await save(s); return send(chat, 'That edit is no longer waiting. Tell me the change again and I will redo it.'); }
  return dispatchEdit(chat, s, e);
}

async function scenesCmd(chat, s) {
  const proj = currentProject(s);
  if (!proj) { await save(s); return send(chat, 'No saved project yet. Make one with /short <topic>.'); }
  const ctx = await loadProject(s, proj.id);
  await save(s);
  if (!ctx) return send(chat, inFlight(s, proj.id) ? `⏳ "${proj.title}" is still being made.` : `I can't find project ${proj.id}.`);
  const t = ctx.view;
  const rows = TLX.scenes(t).map((x) => `${x.n}. ${x.icon} ${x.kind}${x.tool && !['graphic', x.kind].includes(x.tool) ? '/' + x.tool : ''} · ${(+x.end - +x.start).toFixed(1)}s\n   "${x.text.slice(0, 90)}"${x.visual ? `\n   ↳ ${x.visual.slice(0, 70)}` : ''}`);
  return send(chat, `🎬 ${t.title} · v${t.rev}${ctx.queued.length ? ' (incl. edits still rendering)' : ''} · ${t.canvas.width}x${t.canvas.height} · ${t.duration}s\n\n${rows.join('\n')}\n\nSay e.g. "swap scene 3 for a rocket launch", "cut scene 5" or "rewrite the ending".`);
}

const ago = (ms) => { const m = Math.round((Date.now() - ms) / 60e3); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
async function historyCmd(chat, s) {
  const proj = currentProject(s);
  if (!proj) { await save(s); return send(chat, 'No saved project yet.'); }
  const ctx = await loadProject(s, proj.id);
  await save(s);
  if (!ctx) return send(chat, `I can't find project ${proj.id} yet.`);
  const vs = ctx.versions;
  const rows = vs.slice(-12).map((v, i, a) => `v${v.rev} · ${v.message}${v.at ? ' · ' + ago(v.at) : ''}${i === a.length - 1 ? '  ← current' : ''}`);
  const q = ctx.queued.map((e) => `⏳ rendering: ${e.message}`);
  return send(chat, `🕘 ${ctx.repo.title}\n\n${rows.join('\n')}${q.length ? '\n' + q.join('\n') : ''}\n\n/undo goes back one step · /restore <n> brings back v<n> (as a new version, nothing is lost).`);
}

async function revertCmd(chat, s, arg) {
  const proj = currentProject(s);
  if (!proj) { await save(s); return send(chat, 'No saved project yet.'); }
  const ctx = await loadProject(s, proj.id);
  if (!ctx) { await save(s); return send(chat, `I can't find project ${proj.id} yet.`); }
  let target, label;
  if (arg === 'undo') {
    if (ctx.queued.length) {
      // the newest change hasn't rendered yet: drop it from the queue and pin the current repo version
      s.edits = (s.edits || []).filter((e) => e.project_id !== proj.id);
      target = ctx.repo.rev; label = `Undo "${ctx.queued[ctx.queued.length - 1].message}"`;
    } else {
      const to = TLX.undoTarget(ctx.versions);
      if (!to) { await save(s); return send(chat, 'Nothing to undo: this is the first version.'); }
      target = to.rev; label = `Undo: back to v${to.rev} (${to.message})`;
    }
  } else {
    const n = parseInt(String(arg).replace(/^v/i, ''), 10);
    const v = ctx.versions.find((x) => x.rev === n) || (ctx.log.find((h) => h.rev === n) && { rev: n, message: ctx.log.find((h) => h.rev === n).message });
    if (!v) { await save(s); return send(chat, `There's no v${arg}. /history lists the versions.`); }
    if (n === ctx.repo.rev && !ctx.queued.length) { await save(s); return send(chat, `v${n} is already the current version.`); }
    target = n; label = `Restore v${n} (${v.message})`;
  }
  const edit = { id: newEditId(), project_id: proj.id, revert: target, message: label.slice(0, 80), summary: label, detail: '♻️ Saved voice and pictures are reused, so nothing is regenerated.', at: Date.now() };
  s.pending_edit = null;
  return dispatchEdit(chat, s, edit, proj);
}

async function projectCmd(chat, s, arg) {
  const list = (s.projects || []).filter((p) => p.id);
  const cur = currentProject(s);
  if (!arg) {
    await save(s);
    if (!list.length) return send(chat, 'No saved projects yet. Make one with /short <topic>.');
    return send(chat, `📁 Projects (edits go to the one marked ←):\n\n${list.map((p, i) => `${i + 1}. ${p.title}\n   ${p.id}${cur?.id === p.id ? '  ←' : ''}`).join('\n')}\n\nSwitch with /project <number or id>.`);
  }
  const a = arg.trim().toLowerCase();
  let p = /^\d+$/.test(a) ? list[+a - 1] : list.find((x) => x.id === a) || list.find((x) => x.title.toLowerCase().includes(a) || x.id.includes(a));
  if (!p && /^[a-z0-9][a-z0-9-]{2,80}$/.test(a)) {  // any project in the repo, even one made outside the bot
    const tl = await ghRaw(`media/projects/${a}/timeline.json`).catch(() => null);
    if (tl) { const t = JSON.parse(tl); p = { id: t.id, title: t.title, topic: t.meta?.topic || '', canvas: t.canvas, at: Date.now() }; s.projects = [p, ...(s.projects || [])].slice(0, 8); }
  }
  if (!p) { await save(s); return send(chat, `I can't find "${arg}". /project lists them.`); }
  s.current_project = p.id;
  if (s.pending_edit && s.pending_edit.project_id !== p.id) s.pending_edit = null;
  remember(s, 'bot', `Switched edits to "${p.title}"`);
  await save(s);
  return send(chat, `📁 Now editing "${p.title}". /scenes shows its scenes; tell me any change.`);
}


// ---------- A single image on request (Cloudflare FLUX, straight from the proxy, while renders carry on) ----------
// ---------- Free stock photos from Pixabay (when FLUX fails, or when asked for) ----------
const STOCK_ASK = /\b(stock|free photos?|real photos?|pixabay)\b/i;
async function stockPhoto(chat, s, prompt, note = '') {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return false;
  const skip = new Set('a an the of in on at to for with and or from by is are image picture photo photos pic stock free real please make show give me my some use using vibrant detailed illuminated cinematic bustling glowing high contrast lighting grain cyberpunk documentary showing under sunny lush walking along'.split(' '));
  const words = String(prompt).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !skip.has(w));
  const proper = (String(prompt).replace(/^\W*\w+/, '').match(/\b[A-Z][a-z]{2,}\b/g) || []).map((w) => w.toLowerCase()).filter((w, i, a) => a.indexOf(w) === i && !skip.has(w));
  const need = words.slice(0, 4);
  const rest = words.filter((w) => !proper.includes(w));
  const queries = [...new Set([need.join(' '), proper[0] ? proper[0] + ' ' + rest.slice(0, 1).join(' ') : '', proper[0] ? proper[0] + ' city' : '', proper.join(' '), proper[0] || '', words.slice(0, 2).join(' ')].map((x) => x.trim()))].filter(Boolean).slice(0, 3);
  for (const q of queries) {
    try {
      const r = await fetch(`https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&image_type=photo&safesearch=true&per_page=10&order=popular`);
      const d = await r.json().catch(() => ({}));
      const ok = (h) => { const tg = String(h.tags || '').toLowerCase(); if (proper.length) return tg.includes(proper[0]); const m = need.filter((w) => tg.includes(w)).length; return m >= Math.min(2, need.length); };
      const pool = (d.hits || []).slice(0, 6);
      const verdict = await judgeImages(prompt, pool.map((h) => ({ url: h.webformatURL || h.previewURL, tags: h.tags })));
      let hit = null, hitNote = '';
      if (verdict && verdict.ok) { hit = pool[verdict.index]; if (verdict.place === 'unknown' && proper.length) hitNote = 'The picture matches the scene, but I cannot confirm it is really ' + proper[0] + '.'; }
      else if (!verdict) { hit = pool.find(ok); if (hit) hitNote = '(Not visually checked: my picture check was unavailable, so this is matched by tags only.)'; }
      if (!hit) continue;
      const ir = await fetch(hit.largeImageURL || hit.webformatURL);
      if (!ir.ok) continue;
      const buf = Buffer.from(await ir.arrayBuffer());
      const form = new FormData();
      form.append('chat_id', chat);
      form.append('caption', (`📷 ${prompt}`).slice(0, 700) + `\n(free stock photo by ${hit.user} on Pixabay: ${hit.pageURL})` + (hitNote ? '\n' + hitNote : '') + (note ? `\n${note}` : ''));
      form.append('photo', new Blob([buf], { type: 'image/jpeg' }), 'photo.jpg');
      await fetch(`https://api.telegram.org/bot${TG}/sendPhoto`, { method: 'POST', body: form });
      try { await hive('match_log', { request: String(prompt).slice(0, 200), tool: 'pixabay-photo', verdict: 'sent', note: hitNote || (verdict && verdict.ok ? 'visual ok' : 'tags only') }); } catch (e) {}
      remember(s, 'bot', `Sent a free stock photo for: ${String(prompt).slice(0, 120)}`);
      await save(s);
      return true;
    } catch (e) { console.log('stockPhoto', e && e.message); }
  }
  try { await hive('match_log', { request: String(prompt).slice(0, 200), tool: 'pixabay-photo', verdict: 'nomatch' }); } catch (e) {}
  return false;
}
async function makeImage(chat, s, prompt) {
  if (STOCK_ASK.test(prompt)) {
    if (await stockPhoto(chat, s, prompt)) return;
    await save(s);
    return send(chat, '📷 I searched free stock photos and found nothing that really matches that, so I did not send a random one. Want me to try different words, or make it with AI when the Cloudflare quota is back (around 1 AM your time)?');
  }
  const acct = process.env.CLOUDFLARE_ACCOUNT_ID, key = process.env.CLOUDFLARE_API_TOKEN;
  if (!acct || !key) { await save(s); return send(chat, '🖼️ To make images here, add CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN to Vercel (same values as your GitHub secrets), then redeploy.'); }
  await tg('sendChatAction', { chat_id: chat, action: 'upload_photo' });
  // Best free model first (FLUX.2 klein 9B), then cheaper ones if the daily allowance is low.
  const full = `${prompt}. Cinematic lighting, rich colour, sharp focus, highly detailed.`.slice(0, 2000);
  let image, model, why = '', quota = false;
  for (const m of ['flux-2-klein-9b', 'flux-2-klein-4b', 'flux-1-schnell']) {
    let body, headers = { Authorization: 'Bearer ' + key };
    if (m.startsWith('flux-2')) { body = new FormData(); body.append('prompt', full); body.append('width', '1024'); body.append('height', '1024'); }
    else { body = JSON.stringify({ prompt: full, steps: 8 }); headers['Content-Type'] = 'application/json'; }
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/ai/run/@cf/black-forest-labs/${m}`, { method: 'POST', headers, body });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.result?.image) { image = d.result.image; model = m; break; }
    why = `${m}: ${r.status} ${JSON.stringify(d.errors || d).slice(0, 140)}`;
    quota = r.status === 429 || /quota|limit|neurons|4006/i.test(why);
  }
  if (!image) {
    if (await stockPhoto(chat, s, prompt, "Cloudflare couldn't make this one just now, so here's a real stock photo instead.")) return;
    await send(chat, '📷 I also searched free stock photos and found no close match for that, so I did not send a random one.');
    if (quota) return pause(chat, s, { step: 'message', text: '/image ' + prompt, title: 'your image' }, 'images', why);
    await save(s);
    return send(chat, `⚠️ Cloudflare couldn't make that image (${why}).`);
  }
  const d = { result: { image } };
  const form = new FormData();
  form.append('chat_id', chat);
  form.append('caption', (`🖼️ ${prompt}`).slice(0, 990) + `\n(${model})`);
  form.append('photo', new Blob([Buffer.from(d.result.image, 'base64')], { type: 'image/jpeg' }), 'image.jpg');
  await fetch(`https://api.telegram.org/bot${TG}/sendPhoto`, { method: 'POST', body: form });
  remember(s, 'bot', `Made an image: ${prompt.slice(0, 120)}`);
  await save(s);
  await hive('add', { items: [{ kind: 'event', text: `Shorts Studio made an image: ${prompt.slice(0, 150)}`, tags: ['image'] }] });
}

async function cancel(chat, s) {
  Object.assign(s, { stage: 'idle', pitch: null, script: null, working: null });
  remember(s, 'bot', 'Cancelled the current short');
  await save(s);
  await send(chat, '❌ Cancelled. Send /short <topic> whenever you want another.');
}
async function approve(chat, s) {
  if (s.stage === 'pitch') return writeScript(chat, s);
  if (s.stage === 'script') return render(chat, s);
  return send(chat, 'Nothing waiting for approval. Send /short <topic> to start one.');
}
async function redo(chat, s) {
  if (s.stage === 'pitch') return startPitch(chat, s, s.topic, 'Give a completely different angle and hook.');
  if (s.stage === 'script') return writeScript(chat, s, 'Rewrite it with a stronger hook and tighter lines.');
  return reviseLast(chat, s, 'a fresh take with a stronger hook and new visuals');
}
// Bring the last finished short back to the script stage with the change applied.
async function reviseLast(chat, s, feedback, target = 'script') {
  const last = (s.projects || [])[0];
  if (!last) return send(chat, "There's no finished short to redo yet. Send /short <topic> to make one.");
  Object.assign(s, { topic: last.topic, pitch: last.pitch, script: last.script, research: last.research });
  await send(chat, `🔁 Reworking "${last.title}": ${feedback}`);
  if (target === 'pitch') return startPitch(chat, s, last.topic, feedback);
  return writeScript(chat, s, feedback);
}

// ---------- Paused jobs: quotas run out, work waits, then resumes ----------
const isLimit = (e) => /\b(429|402|503|502|529)\b|quota|rate.?limit|exhaust|resource_exhausted|limit/i.test(String(e?.message || e));
const STEP_NAME = { pitch: 'pitch', script: 'script', render: 'images', message: 'your last message' };

async function pause(chat, s, job, service, reason) {
  const keep = !!s.resumeAuto;
  s.resumeAuto = false;
  s.pending = { ...job, service, reason: String(reason).slice(0, 160), auto: keep, asked: false, since: Date.now(),
    snapshot: { topic: s.topic, pitch: s.pitch, script: s.script, research: s.research } };
  s.working = null;
  await save(s);
  const what = service === 'images' ? "Cloudflare's free daily image quota" : 'the free AI writing quota';
  if (keep) return send(chat, `⏸️ "${job.step === 'message' ? String(job.text || '').slice(0, 60) : job.title}" hit ${what} again. I'll keep trying after the next reset.`);
  const kb = [[{ text: "⏰ Continue by itself when it's back", callback_data: 'p:auto' }], [{ text: '🔔 Ask me first', callback_data: 'p:ask' }]];
  if (service === 'images') kb.unshift([{ text: '🎬 Render now with plain backgrounds', callback_data: 'p:plain' }]);
  kb.push([{ text: '🗑 Drop it', callback_data: 'p:drop' }]);
  const head = job.step === 'message'
    ? `⏸️ I couldn't act on "${String(job.text || '').slice(0, 80)}" yet: ${what} ran out. I saved it.`
    : `⏸️ Paused "${job.title || 'your short'}" at the ${STEP_NAME[job.step] || job.step} step: ${what} ran out. Everything is saved.`;
  await send(chat, `${head}\n\nIt resets around 1 AM your time. What should I do then?`, { inline_keyboard: kb });
}

async function resume(chat, s, viaTick = false) {
  const p = s.pending;
  if (!p) return send(chat, 'Nothing is paused right now.');
  s.pending = null;
  s.resumeAuto = !!p.auto;
  Object.assign(s, p.snapshot || {});
  await send(chat, `▶️ ${viaTick ? "The quota's back. " : ''}` + (p.step === 'message' ? `Picking up your message: "${String(p.text || '').slice(0, 80)}"` : `Picking up "${p.title}" at the ${STEP_NAME[p.step] || p.step} step.`));
  if (p.step === 'pitch') return startPitch(chat, s, p.topic, p.feedback || '');
  if (p.step === 'script') return writeScript(chat, s, p.feedback || '');
  if (p.step === 'render') return render(chat, s, { plain: p.plain });
  if (p.step === 'message') return handleText(chat, s, p.text, true);
}

// Runs a step; when a free quota runs out, the job is parked instead of lost.
async function safely(chat, s, fn) {
  try { await fn(); }
  catch (e) {
    console.error(e);
    if (!isLimit(e)) await reportError(e, { source: 'studio', file: 'api/studio.mjs', chat });
    if (isLimit(e) && s.working) return pause(chat, s, s.working, 'llm', e.message);
    s.working = null;
    await send(chat, '⚠️ Something broke on my side: ' + String(e.message || e).slice(0, 200) + '. Send it again and I will retry.');
    try { await save(s); } catch (_) {}
  }
}

const HELP = `🎬 Shorts Studio\n\nSend /short <topic>, or just say it with the look and length you want: "a 3 minute documentary for YouTube about how money came to be", "the daily life of Adam in stop motion". I pick the best look per topic when you don't say (/styles).\n🎨 Send a video or a link and say "learn this style": I study it and make your next videos look like it.\nI research it, pitch it, write a fact-checked script, pick the best tool for each shot (Cloudflare, PixelLab, Hugging Face motion), then render it once you approve.\n\nI remember our chat, so "redo it" means the last short. If a free quota runs out I pause and pick it back up later.\n\n/studio status · /library your shorts · /tools settings\n\n✏️ Every short is an editable project. Just tell me a change: "swap scene 3 for a rocket launch", "make the hook punchier", "cut scene 5", "bigger yellow captions", "change the music", "make it 16:9". I show what changes and you tap Apply (start with "just" to skip that). Only the changed lines and pictures are remade.\n/scenes list scenes · /history versions · /undo · /restore <n> · /project switch video · /reformat 16:9 · /captions neon`;

async function handleText(chat, s, text, replay = false) {
  const low = text.toLowerCase().trim();
  if (!replay) { remember(s, 'user', text); s.resumeAuto = false; }
  if (s.awaitImage) { const recent = Date.now() - s.awaitImage < 600000; s.awaitImage = null; if (recent && !text.trim().startsWith('/')) return makeImage(chat, s, text.trim()); }
  if (STOCK_ASK.test(text) && s.pending && s.pending.step === 'message' && String(s.pending.text || '').startsWith('/image ')) { const pp = String(s.pending.text).slice(7); if (await stockPhoto(chat, s, pp)) { s.pending = null; await save(s); return; } }
  if (low === '/start') return suggest(chat, s, false, '🎬 Shorts Studio is ready. I share one memory with your assistant bot, so I know what you like.');
  if (low === '/help') { await save(s); return send(chat, HELP, appButton()); }
  if (low === '/ideas') return suggest(chat, s, true);
  if (low.startsWith('/image') && !text.slice(6).trim()) { s.awaitImage = Date.now(); await save(s); }
  if (low.startsWith('/image')) return text.slice(6).trim() ? makeImage(chat, s, text.slice(6).trim()) : send(chat, '🖼️ Describe it, e.g. /image a golden lion on a Lagos rooftop at sunset');
  if (low.startsWith('/library')) { await save(s); return send(chat, '🎞 Your shorts:', appButton()); }
  if (low.startsWith('/tools')) {
    const set = s.settings || {};
    await save(s);
    return send(chat, `🧰 Tools\n📐 Format: ${FORMAT_LABEL[fmtOf(set)]}${set.caption_style ? `\n🔤 Captions: ${set.caption_style}` : ''}\n🖼️ Cloudflare FLUX: free, default stills\n👾 PixelLab: ${set.pixellab === false ? 'off' : 'on'} (pixel-art shots, about 1 cent each)\n🎥 Hugging Face motion: ${set.higgsfield === false ? 'off' : 'on'}, up to ${set.max_motion ?? 2} motion clips per short (free, about 5 GPU min a day)\n📊 Motion graphics: ${set.graphics === false ? 'off' : 'on'} (animated charts, counters, lists and titles, free)\n🌐 Browser bot: deep research on every new topic, plus deep-dig ideas\n✨ Gemini: quick research, writing, fact-checks and routing${set.gemini_images ? ', plus backup images when Cloudflare fails' : ''}\n\nTell me e.g. "turn off motion", "use 3 motion clips", "make them square" or "use neon captions".\nRe-shape or restyle the last short without remaking it: /reformat 16:9 · /captions karaoke-box`);
  }
  if (low.startsWith('/reformat')) {
    const cv = canvasFor(text.slice(9));
    if (!cv) { await save(s); return send(chat, '📐 Which shape? /reformat 16:9, /reformat 9:16, /reformat 1:1, /reformat 4:5 (or e.g. 1280x720). It re-renders your last short in that shape.'); }
    return rerender(chat, s, [{ op: 'replace', path: '/canvas', value: cv }], `reformat to ${cv.width}x${cv.height}`, `as ${cv.width}x${cv.height}`);
  }
  if (low.startsWith('/captions')) {
    const pre = low.slice(9).trim();
    if (!CAPTION_PRESETS.includes(pre)) { await save(s); return send(chat, `🔤 Caption styles: ${CAPTION_PRESETS.join(', ')}.\n/captions neon restyles your last short. To use one for new shorts, say "use neon captions".`); }
    return rerender(chat, s, [{ op: 'replace', path: '/style/caption', value: { preset: pre } }], `captions ${pre}`, `with ${pre} captions`);
  }
  if (low === '/styles' || low === '/style') {
    await save(s);
    const mine = Object.values(s.styles || {}).map((x) => `• ${x.name}: ${String(x.summary || '').slice(0, 90)}`).join('\n');
    return send(chat, `🎬 Looks I can make:\n${SX.RECIPE_NAMES.map((k) => `• ${k}: ${SX.RECIPES[k].label}`).join('\n')}\n\n🎨 Learned from your references:\n${mine || '• none yet: send me a video or a link and say "learn this style"'}\n\nNow using: ${s.settings?.style ? `"${s.settings.style}"` : s.settings?.recipe || 'auto (I pick per topic)'}.\nSay e.g. "use documentary style", "auto style", or /look stop-motion to restyle your last video.`);
  }
  if (low.startsWith('/look')) {
    const name = low.slice(5).trim();
    if (!SX.RECIPES[name]) { await save(s); return send(chat, `🎬 Which look? /look ${SX.RECIPE_NAMES.join(' | /look ')}`); }
    return rerender(chat, s, [{ op: 'merge', path: '/style', value: { apply_recipe: SX.RECIPES[name].render || name } }], `look ${name}`, `in the ${SX.RECIPES[name].label} look`);
  }
  if (/^\s*(auto|automatic)\s+(style|look)\b|\b(stop|don'?t) using (the |my )?[\w-]+ style\b/i.test(text)) {
    s.settings = { ...(s.settings || {}) }; delete s.settings.style; delete s.settings.recipe;
    await save(s);
    return send(chat, '🎬 Back to auto: I pick the look that fits each topic.');
  }
  const urlHit = text.match(VIDEO_URL);
  if (urlHit && (/\b(style|look|like this|like that|reference|learn|copy|same (as|way)|vibe|editing)\b/i.test(text) || text.trim() === urlHit[0])) return learnStyle(chat, s, urlHit[0], text);
  if (low === '/scenes' || low.startsWith('/scenes ')) return scenesCmd(chat, s);
  if (low === '/history' || low.startsWith('/history ') || low === '/versions') return historyCmd(chat, s);
  if (low === '/undo') return revertCmd(chat, s, 'undo');
  if (low.startsWith('/restore')) {
    const n = text.slice(8).trim();
    if (!n) { await save(s); return send(chat, '🕘 Which version? e.g. /restore 3 (see /history).'); }
    return revertCmd(chat, s, n);
  }
  if (low === '/project' || low.startsWith('/project ') || low === '/projects') return projectCmd(chat, s, low === '/projects' ? '' : text.slice(8).trim());
  if (low.startsWith('/edit')) {
    const ask = text.slice(5).trim();
    if (!ask) { await save(s); return send(chat, '✏️ Tell me the change, e.g. /edit swap scene 3 for a rocket launch. (Plain messages work too.)'); }
    return editRequest(chat, s, ask, /^\s*just\b/i.test(ask));
  }
  if (low.startsWith('/short')) {
    const topic = text.slice(6).trim();
    if (!topic) return suggest(chat, s);
    return startPitch(chat, s, topic);
  }
  if (low.startsWith('/studio')) {
    const cmd = low.slice(7).trim();
    if (cmd === 'cancel') return cancel(chat, s);
    if (cmd === 'approve') return approve(chat, s);
    if (cmd === 'redo') return redo(chat, s);
    await save(s);
    const bg = (s.renders || []).filter((x) => Date.now() - x.at < 25 * 60e3).map((x) => `\n⏳ Rendering: "${x.title}"`).join('');
    return send(chat, `🎬 Stage: ${s.stage || 'idle'}${s.pitch ? `, "${s.pitch.title}"` : ''}${bg}${s.pending ? `\n⏸️ Paused: "${s.pending.title}" (${s.pending.auto ? 'resumes by itself' : 'I will ask you'})` : ''}`);
  }
  const live = ['pitch', 'script'].includes(s.stage);
  if (live && YES.test(text)) return approve(chat, s);
  if (live && NO.test(text)) return cancel(chat, s);
  // A proposed edit is waiting: yes applies it, no drops it.
  if (s.pending_edit && YES.test(text)) return applyPending(chat, s);
  if (s.pending_edit && (NO.test(text) || /^\s*no\W*$/i.test(text))) { s.pending_edit = null; await save(s); return send(chat, '👍 Dropped that edit. The video stays as it is.'); }
  // "Make/create a ... video about X" is always a new video (never an edit of the last one).
  if (!live && !replay && NEW_VIDEO_RE.test(text)) return startPitch(chat, s, text);
  // Edits to the saved video skip the router: one model call does it (fits the 60s limit).
  if (!live && !replay && looksLikeEdit(s, text)) return editRequest(chat, s, text, /^\s*just\b/i.test(text));
  const fresh = !(s.history || []).length && !(s.projects || []).length && !s.pending && !live;
  if (fresh) return /^(hi|hey|hello|yo|sup|good (morning|afternoon|evening))\b/i.test(low) ? suggest(chat, s) : startPitch(chat, s, text);

  s.working = { step: 'message', text, title: 'your last message' };
  const d = await llm([{ role: 'system', content: ROUTER }, { role: 'user', content: `CONTEXT:\n${context(s)}\n${hiveText(await hive('recall', { query: text, limit: 6 }))}\n\nCurrent work: ${JSON.stringify(s.script || s.pitch || {}).slice(0, 1500)}\n\nNEW MESSAGE: ${text}` }], 0, false);
  s.working = null;
  switch (d.intent) {
    case 'approve': return approve(chat, s);
    case 'cancel': return cancel(chat, s);
    case 'new_topic': return startPitch(chat, s, d.topic || text);
    case 'learn_style': {
      const u = (String(d.url || '').match(VIDEO_URL) || text.match(VIDEO_URL) || [])[0];
      if (u) return learnStyle(chat, s, u, text);
      await save(s);
      return send(chat, '🎨 Send me the reference: a YouTube/TikTok link, or the video file itself (up to 20 MB). I study it and save the look.');
    }
    case 'edit': {
      if (live) return s.stage === 'pitch' ? startPitch(chat, s, s.topic, d.feedback || text) : writeScript(chat, s, d.feedback || text);
      return editRequest(chat, s, text, /^\s*just\b/i.test(text));
    }
    case 'revise': {
      const fb = d.feedback || text;
      LEARN_NEXT = { user: text, bot: `Revising the short: ${fb}` };
      if (d.target === 'video' || !live) return reviseLast(chat, s, fb);
      return s.stage === 'pitch' ? startPitch(chat, s, s.topic, fb) : writeScript(chat, s, fb);
    }
    case 'resume': return resume(chat, s);
    case 'resume_later': {
      if (!s.pending) { await save(s); return send(chat, 'Nothing is paused right now.'); }
      s.pending.auto = d.auto !== false;
      remember(s, 'bot', s.pending.auto ? 'Will auto-resume the paused job' : 'Will ask before resuming');
      await save(s);
      return send(chat, s.pending.auto ? `👍 I'll carry on with "${s.pending.title}" by myself as soon as the quota resets. No need to approve that.` : `👍 I'll message you when the quota's back and ask before continuing.`);
    }
    case 'settings': {
      s.settings = { ...(s.settings || {}), ...(d.settings || {}) };
      if (s.settings.recipe === 'auto' || (s.settings.recipe && !SX.RECIPES[s.settings.recipe])) delete s.settings.recipe;
      if (s.settings.style === 'none' || (s.settings.style && !(s.styles || {})[s.settings.style])) {
        if (s.settings.style && SX.RECIPES[s.settings.style]) s.settings.recipe = s.settings.style;
        delete s.settings.style;
      }
      remember(s, 'bot', 'Updated tool settings');
      LEARN_NEXT = { user: text, bot: 'Saved tool settings' };
      await save(s);
      const set = s.settings;
      return send(chat, `🧰 Saved. Format ${FORMAT_LABEL[fmtOf(set)]}${set.caption_style ? `, ${set.caption_style} captions` : ''}. Motion ${set.higgsfield === false ? 'off' : `on (up to ${set.max_motion ?? 2} clips)`}, PixelLab ${set.pixellab === false ? 'off' : 'on'}.`);
    }
    case 'status': await save(s); return handleText(chat, s, '/studio', true);
    case 'ideas': return suggest(chat, s, true);
    case 'study': {
      const ok = await askBrowserBot(chat, { purpose: 'study', topic: d.topic || '', playbook: s.playbook || '' });
      await save(s);
      return send(chat, ok ? `📚 Sent your browser bot to study top videos${d.topic ? ' on ' + d.topic : ''}: hooks, pacing, captions, visual and art style. It takes 5 to 10 minutes; I'll save the playbook and use it in every pitch and script.` : "⚠️ I couldn't reach the browser bot (check GH_TOKEN and GH_REPO on Vercel).");
    }
    case 'image': return makeImage(chat, s, d.prompt || text);
    default: {
      const reply = d.reply || "I'm here. Send a topic, or say redo to rework the last short.";
      remember(s, 'bot', reply);
      LEARN_NEXT = { user: text, bot: reply };
      await save(s);
      return send(chat, reply);
    }
  }
}

async function handleButton(chat, s, data) {
  if (data.startsWith('edit:apply')) return applyPending(chat, s, data.slice(11) || null);
  if (data === 'edit:cancel') { s.pending_edit = null; await save(s); return send(chat, '👍 Dropped that edit. The video stays as it is.'); }
  if (data === 'approve') return approve(chat, s);
  if (data === 'redo') return redo(chat, s);
  if (data === 'cancel') return cancel(chat, s);
  if (data === 'ideas') return suggest(chat, s, true);
  if (data === 'ideas:deep') {
    const mem = await hive('recall', { query: 'interests topics shorts ideas liked', limit: 12 });
    const ok = await askBrowserBot(chat, { purpose: 'ideas', interests: hiveText(mem).slice(0, 1500), made: (s.projects || []).map((p) => p.title).slice(-20) });
    return send(chat, ok ? '🌐 Your browser bot is hunting fresh, trending ideas (2 to 5 min). I stay free meanwhile.' : "⚠️ I couldn't reach the browser bot (GH_TOKEN / GH_REPO on Vercel).");
  }
  if (data === 'deep:pitch' && s.topic) return startPitch(chat, s, s.topic, 'Use the new deep research facts from the browser bot to sharpen the hook and key facts.');
  if (data === 'deep:script' && s.pitch) return writeScript(chat, s, 'Rebuild it on the new deep research facts from the browser bot; keep what works.');
  if (data.startsWith('idea:')) {
    const x = (s.ideas || [])[Number(data.slice(5))];
    if (!x) return suggest(chat, s, true);
    remember(s, 'user', `Picked the idea "${x.title}"`);
    return startPitch(chat, s, x.topic);
  }
  if (!s.pending) return send(chat, 'That job is no longer paused.');
  if (data === 'p:auto' || data === 'p:ask') {
    s.pending.auto = data === 'p:auto';
    await save(s);
    return send(chat, s.pending.auto ? `👍 I'll carry on with "${s.pending.title}" by myself once the quota resets. No need to approve that.` : `👍 I'll ask you in the morning when the quota is back.`);
  }
  if (data === 'p:plain') { s.pending.plain = true; return resume(chat, s); }
  if (data === 'p:go') return resume(chat, s);
  if (data === 'p:drop') { const t = s.pending.title; s.pending = null; await save(s); return send(chat, `🗑 Dropped "${t}".`); }
}

// ---------- Scheduled check (GitHub cron) and render callbacks ----------
const keyOk = (req) => req.headers['x-studio-key'] === crypto.createHash('sha256').update(TG || '').digest('hex').slice(0, 32);

async function tick(req, res) {
  const s = await load();
  const p = s.pending;
  const chat = ALLOWED || s.chat;
  if (!p || !chat) return res.status(200).json({ pending: false });
  let back = false;
  if (p.service === 'images') back = req.query.cf === 'ok';
  else { try { await llm([{ role: 'system', content: 'Reply with JSON {"ok": true}' }, { role: 'user', content: 'ping' }], 0, false); back = true; } catch (e) { back = !isLimit(e); } }
  if (!back) return res.status(200).json({ pending: true, back: false });
  const hour = (new Date().getUTCHours() + Number(process.env.STUDIO_TZ_OFFSET || 1) + 24) % 24;
  if (p.auto) await safely(chat, s, () => resume(chat, s, true));
  else if (!p.asked && hour >= 7 && hour < 22) {
    p.asked = true;
    await save(s);
    await send(chat, p.step === 'message' ? `✅ The quota is back. Shall I act on your message now: "${String(p.text || '').slice(0, 80)}"?` : `✅ The quota is back. Continue "${p.title}" from the ${STEP_NAME[p.step] || p.step} step?`, { inline_keyboard: [[{ text: '▶️ Continue', callback_data: 'p:go' }], [{ text: '🗑 Drop it', callback_data: 'p:drop' }]] });
  }
  return res.status(200).json({ pending: true, back: true, auto: p.auto });
}

async function renderPaused(req, res) {
  const s = await load();
  const chat = ALLOWED || s.chat;
  const b = req.body || {};
  const last = (s.projects || [])[0];
  if (last) Object.assign(s, { topic: last.topic, pitch: last.pitch, script: last.script, research: last.research });
  s.resumeAuto = !!(s.lastRenderAuto);
  await pause(chat, s, { step: 'render', title: last?.title || 'your short' }, b.service || 'images', b.reason || 'quota');
  return res.status(200).json({ ok: true });
}

// ---------- Handoff: the assistant bot passes a video request over (through the proxy, never in Telegram) ----------
async function handoff(req, res) {
  if ((req.headers.authorization || '').replace('Bearer ', '') !== process.env.PROXY_KEY) return res.status(401).end();
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const topic = String(b.topic || '').trim();
  const s = await load();
  const chat = ALLOWED || s.chat;
  if (!topic || !chat) return res.status(400).json({ error: 'topic and a known chat needed' });
  remember(s, 'user', `(via the assistant) ${b.request || topic}`);
  await send(chat, `📨 Your assistant passed this over: "${topic.slice(0, 120)}"`);
  await safely(chat, s, () => startPitch(chat, s, topic, b.note || ''));
  return res.status(200).json({ ok: true });
}

// ---------- Setup: open <your proxy>/api/studio?setup=1 once ----------
async function setup(res) {
  const w = await tg('setWebhook', { url: BASE + '/api/studio', allowed_updates: ['message', 'callback_query'], ...(SECRET ? { secret_token: SECRET } : {}) });
  await tg('setMyCommands', { commands: [
    { command: 'short', description: 'Make a short: /short <topic>' },
    { command: 'ideas', description: 'Fresh researched ideas' },
    { command: 'image', description: 'Make one image: /image <description>' },
    { command: 'library', description: 'Open your finished shorts' },
    { command: 'studio', description: 'Where things stand' },
    { command: 'tools', description: 'Paid tool settings' },
    { command: 'scenes', description: 'Scenes of the video you are editing' },
    { command: 'edit', description: 'Change the video: /edit <what to change>' },
    { command: 'history', description: 'Versions of this video' },
    { command: 'undo', description: 'Undo the last change (re-renders)' },
    { command: 'restore', description: 'Bring back a version: /restore <n>' },
    { command: 'project', description: 'Switch which video edits go to' },
  ] });
  const m = await tg('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Studio', web_app: { url: APP } } });
  const s = await load();
  s.base = BASE;
  await save(s);
  return res.status(200).json({ webhook: w?.ok ? 'set' : w?.description || 'failed', menu: m?.ok ? 'set' : m?.description || 'failed', app: APP });
}

async function studioHandler(req, res) {
  T0 = Date.now();
  BASE = 'https://' + req.headers.host;
  APP = BASE + '/api/studio-app';
  if (req.query?.handoff) return handoff(req, res);
  if (req.query?.research) return researchBack(req, res);
  if (req.query?.tick || req.query?.event) {
    if (!keyOk(req)) return res.status(401).end();
    return req.query.tick ? tick(req, res) : req.query.event === 'style' ? styleBack(req, res) : renderPaused(req, res);
  }
  if (req.method === 'GET') {
    if (req.query?.setup) return setup(res);
    return res.status(200).send('studio ok');
  }
  if (SECRET && req.headers['x-telegram-bot-api-secret-token'] !== SECRET) return res.status(401).end();
  const u = req.body || {};
  const cb = u.callback_query;
  const msg = u.message;
  const chat = String((cb ? cb.message.chat.id : msg?.chat?.id) || '');
  if (!chat || (ALLOWED && chat !== ALLOWED)) return res.status(200).end();

  if (cb && String(cb.data || '').startsWith('fx:')) { await fixerButton({ bot: 'studio', cb }); return res.status(200).end(); }

  const s = await load();
  if (s.last_update && u.update_id <= s.last_update) return res.status(200).end(); // Telegram retry
  s.last_update = u.update_id;
  s.chat = chat;
  s.resumeAuto = false;
  if (!s.base) s.base = BASE;

  await safely(chat, s, async () => {
    if (cb) {
      await tg('answerCallbackQuery', { callback_query_id: cb.id });
      await tg('editMessageReplyMarkup', { chat_id: chat, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } });
      await handleButton(chat, s, cb.data);
    } else if (msg) {
      let text = msg.text || msg.caption || '';
      const vid = msg.video || msg.animation || msg.video_note || (msg.document && /^video\//.test(msg.document.mime_type || '') ? msg.document : null);
      if (vid) {
        // A video sent to the studio is a style reference.
        if ((vid.file_size || 0) > 20e6) { await save(s); return send(chat, '📼 That file is over Telegram\'s 20 MB limit for bots. Send a shorter clip, or a YouTube link to it.'); }
        return learnStyle(chat, s, 'tg:' + vid.file_id, text);
      }
      const voice = msg.voice || msg.audio;
      if (!text && voice) {
        text = await transcribe(voice.file_id);
        if (!text) await send(chat, "🎤 I couldn't make out that voice note. Mind sending it again?");
        else await send(chat, `🎤 "${text.slice(0, 200)}"`);
      }
      if (text) await handleText(chat, s, text);
      else await save(s);
    }
  });
  if (LEARN_NEXT) { const l = LEARN_NEXT; LEARN_NEXT = null; await hive('learn', l); }
  return res.status(200).end();
}

// fixer: report crashes of this webhook, then still answer 200 so Telegram does not retry forever
export default async function handler(req, res) {
  try { return await studioHandler(req, res); }
  catch (e) {
    console.error(e);
    const b = req.body || {};
    await reportError(e, { source: 'studio', file: 'api/studio.mjs', chat: String(b.message?.chat?.id || b.callback_query?.message?.chat?.id || '') });
    if (!res.headersSent) return res.status(200).end();
  }
}
