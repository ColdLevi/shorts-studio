import crypto from 'node:crypto';

import { fixerButton, reportError } from './_fixer.mjs';
const TG = process.env.TELEGRAM_TOKEN;
const GH = process.env.GH_TOKEN;
const REPO = process.env.GH_REPO;
const ALLOWED = process.env.ALLOWED_CHAT_ID;

async function tg(method, body) {
  try {
    const r = await fetch('https://api.telegram.org/bot' + TG + '/' + method, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return await r.json();
  } catch (e) { return null; }
}

function gh(path, opts = {}) {
  return fetch('https://api.github.com/repos/' + REPO + '/' + path, {
    ...opts,
    headers: { Authorization: 'Bearer ' + GH, Accept: 'application/vnd.github+json', 'User-Agent': 'tg-bot' }
  });
}

async function ghWrite(path, data, message) {
  const r = await gh('contents/' + path);
  const sha = r.ok ? (await r.json()).sha : undefined;
  return gh('contents/' + path, {
    method: 'PUT',
    body: JSON.stringify({ message: message + ' [skip ci]', content: Buffer.from(JSON.stringify(data)).toString('base64'), sha })
  });
}

function encrypt(text) {
  const key = crypto.createHash('sha256').update(process.env.PROXY_KEY || '').digest();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(text, 'utf8'), c.final(), c.getAuthTag()]);
  return { iv: iv.toString('base64'), data: data.toString('base64') };
}

// Voice note -> text with Groq Whisper
async function transcribe(fileId) {
  const f = await tg('getFile', { file_id: fileId });
  if (!f || !f.ok) return '';
  const audio = await (await fetch('https://api.telegram.org/file/bot' + TG + '/' + f.result.file_path)).arrayBuffer();
  const form = new FormData();
  form.append('file', new Blob([audio], { type: 'audio/ogg' }), 'voice.ogg');
  form.append('model', 'whisper-large-v3-turbo');
  const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + process.env.GROQ_API_KEY }, body: form
  });
  const d = await r.json();
  return (d.text || '').trim();
}

async function dispatch(chat, text, fromVoice) {
  return gh('dispatches', {
    method: 'POST',
    body: JSON.stringify({ event_type: 'run-browser-agent', client_payload: { task: text, prompt: text, chat_id: chat, voice: fromVoice ? 'true' : 'false' } })
  });
}

async function telegramHandler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('ok');
  if (process.env.TG_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== process.env.TG_SECRET) {
    return res.status(401).end();
  }

  // Button taps
  const cb = req.body && req.body.callback_query;
  if (cb) {
    if (String(cb.data || '').startsWith('fx:')) { await fixerButton({ bot: 'browser', cb: cb }); return res.status(200).end(); }
    const chat = String(cb.message.chat.id);
    if (ALLOWED && chat !== ALLOWED) return res.status(200).end();
    if (cb.data === 'speak') {
      await ghWrite('voice/' + chat + '.json', { speak: true, t: Date.now() }, 'voice');
      await tg('answerCallbackQuery', { callback_query_id: cb.id, text: '🔊 I will speak my reply' });
      await tg('editMessageReplyMarkup', { chat_id: chat, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } });
    } else if (cb.data === 'fb:up') {
      await tg('answerCallbackQuery', { callback_query_id: cb.id, text: '👍 Thanks! Learning from this one.' });
      await tg('editMessageReplyMarkup', { chat_id: chat, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } });
      await dispatch(chat, '/learn', false);
    } else if (cb.data === 'fb:down') {
      await ghWrite('feedback/' + chat + '.json', { awaiting: true, t: Date.now() }, 'feedback');
      await tg('answerCallbackQuery', { callback_query_id: cb.id });
      await tg('editMessageReplyMarkup', { chat_id: chat, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } });
      await tg('sendMessage', { chat_id: chat, text: '👎 Sorry about that. What was off? Tell me and I\'ll remember it for next time.' });
    } else {
      await tg('answerCallbackQuery', { callback_query_id: cb.id });
    }
    return res.status(200).end();
  }

  const msg = req.body && req.body.message;
  if (!msg) return res.status(200).end();
  const chat = String(msg.chat.id);
  if (ALLOWED && chat !== ALLOWED) return res.status(200).end();

  await tg('sendChatAction', { chat_id: chat, action: 'typing' });

  let text = (msg.web_app_data && msg.web_app_data.data) || msg.text || msg.caption || '';
  let fromVoice = false;
  const voice = msg.voice || msg.audio;
  if (!text && voice) {
    await tg('sendChatAction', { chat_id: chat, action: 'record_voice' });
    text = await transcribe(voice.file_id);
    if (!text) {
      await tg('sendMessage', { chat_id: chat, text: "🎤 I couldn't make out that voice note. Mind sending it again?" });
      return res.status(200).end();
    }
    fromVoice = true;
  }
  if (!text) return res.status(200).end();

  // If the agent is waiting for an answer, hand this message to it instead of starting a new run
  const r = await gh('contents/inbox/' + chat + '.json');
  if (r.ok) {
    const f = await r.json();
    let box = {};
    try { box = JSON.parse(Buffer.from(f.content, 'base64').toString()); } catch (e) {}
    if (box.waiting && !box.answer) {
      box.answer = encrypt(text);
      await gh('contents/inbox/' + chat + '.json', {
        method: 'PUT',
        body: JSON.stringify({ message: 'answer [skip ci]', content: Buffer.from(JSON.stringify(box)).toString('base64'), sha: f.sha })
      });
      await tg('sendMessage', { chat_id: chat, text: '✍️ Got it, carrying on...', reply_markup: { remove_keyboard: true } });
      return res.status(200).end();
    }
  }

  // Feedback after a 👎 tap
  const fb = await gh('contents/feedback/' + chat + '.json');
  if (fb.ok) {
    const f = await fb.json();
    let box = {};
    try { box = JSON.parse(Buffer.from(f.content, 'base64').toString()); } catch (e) {}
    if (box.awaiting && Date.now() - (box.t || 0) < 30 * 60 * 1000) {
      await ghWrite('feedback/' + chat + '.json', { awaiting: false, t: Date.now() }, 'feedback');
      await dispatch(chat, '/feedback ' + text, false);
      return res.status(200).end();
    }
  }

  if (fromVoice) {
    await ghWrite('voice/' + chat + '.json', { speak: false, t: Date.now() }, 'voice');
    await tg('sendMessage', {
      chat_id: chat, text: '🎤 "' + text.slice(0, 300) + '"\n\nTap to hear my reply, or leave it and I\'ll type.',
      reply_markup: { inline_keyboard: [[{ text: '🔊 Speak back', callback_data: 'speak' }]] }
    });
  }

  const d = await dispatch(chat, text, fromVoice);
  if (!d.ok) await tg('sendMessage', { chat_id: chat, text: '⚠️ Could not start the agent (GitHub said ' + d.status + ').' });
  return res.status(200).end();
}

// fixer: report crashes of this webhook, then still answer 200 so Telegram does not retry forever
export default async function handler(req, res) {
  if (req.query && req.query.tick) return taskqTick(req, res);
  try { return await telegramHandler(req, res); }
  catch (e) {
    console.error(e);
    const b = req.body || {};
    await reportError(e, { source: 'telegram', file: 'api/telegram.mjs', chat: String(b.message?.chat?.id || b.callback_query?.message?.chat?.id || '') });
    if (!res.headersSent) return res.status(200).end();
  }
}


// ---- Taskmaster: resume queued work whose quota window reopened ----
async function taskqTick(req, res) {
  try {
    const base = process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://llm-proxy-one-rose.vercel.app';
    const H = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (process.env.PROXY_KEY || ''), 'x-proxy-key': process.env.PROXY_KEY || '' };
    const post = (body) => fetch(base + '/api/v1/memory', { method: 'POST', headers: H, body: JSON.stringify(body) });
    const g = await post({ op: 'kv_get', key: 'taskq' });
    const doc = g.ok ? (await g.json()).value : null;
    const now = Math.floor(Date.now() / 1000);
    const tasks = (doc && Array.isArray(doc.tasks)) ? doc.tasks : [];
    const due = tasks.filter((t) => t.state === 'waiting' && Number(t.resume_at || 0) <= now);
    const out = [], gaveUp = [];
    for (const t of due) {
      if (Number(t.tries || 1) > 3) { t.state = 'gave_up'; gaveUp.push(t.id); continue; }
      t.state = 'running'; t.started = now;
      await dispatch(t.chat, String(t.payload || 'continue'), false);
      out.push(t.id);
      try {
        await tg('sendMessage', { chat_id: t.chat, text: 'Taskmaster: quota back - resuming ' + String(t.payload || 'continue').slice(0, 60) });
      } catch (e) {}
    }
    if (due.length) await post({ op: 'kv_put', key: 'taskq', value: { tasks, updated: now } });
    return res.status(200).json({ ok: true, due: out, gave_up: gaveUp, total: tasks.length });
  } catch (e) {
    console.log('taskq tick', e && e.message);
    return res.status(200).json({ ok: false, error: String((e && e.message) || e) });
  }
}
