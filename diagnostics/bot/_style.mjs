// Style engine for the Shorts Studio bot: style recipes, reading format/length/style from the request,
// the motion-graphics catalogue (20 graphic types), and learned reference styles.
// The render tokens of each recipe live in shorts-studio tools/timeline.py (STYLE_PRESETS); this file
// holds what the director needs to pick and write for a recipe.

// ---------- recipes ----------
export const RECIPES = {
  'motion-explainer': {
    label: 'Motion-graphics explainer', mode: 'motion-graphics', graphics: 1, beat: 4, music: 'tech-pulse',
    when: 'how something works, processes, systems, numbers and comparisons, tech, money, science, "explained" topics',
    image: 'clean flat vector illustration, bold simple shapes, dark background, high contrast',
    rule: 'EVERY beat is a "graphic" beat (tool "graphic"), the whole video is drawn animation. Vary the graphic type beat to beat (never the same type twice in a row) and lean on icons, flow, versus, stats, kinetic, timeline, map, pie and percent. Use "kinetic" or "title" for the hook.',
  },
  documentary: {
    label: 'Documentary', mode: 'mixed', graphics: 0.3, beat: 6, music: 'docu-pluck', format: 'landscape',
    when: 'history, origins ("how X came to be"), real places, empires, inventions, biographies, mysteries',
    image: 'painterly historical illustration, dramatic chiaroscuro lighting, muted earth tones, aged paper texture, museum-diorama depth',
    rule: 'About a third of beats are graphics, mostly "map", "timeline", "quote", "stats" and "versus". Real places and objects can use "stock" footage. The rest are rich painted stills (they get slow 2.5D parallax). Open on a vivid scene, not a graphic.',
  },
  'stop-motion': {
    label: 'Stop motion', mode: 'stop-motion', graphics: 0.12, beat: 4, music: 'lofi-warm', fps: 24,
    when: 'stories about a character, daily life, routines, playful or cosy topics, crafts, kids',
    image: 'handmade stop-motion scene, clay and felt miniature characters on a tabletop set, cardboard props, soft studio lighting, visible fingerprints and handmade texture, shallow depth of field, same character design in every shot',
    rule: 'Mostly "flux" stills in the stop-motion art style, the SAME character described the same way in every prompt (name, clothes, colours). At most 1 or 2 graphic beats ("kinetic" or "list"). No stock footage.',
  },
  cinematic: {
    label: 'Cinematic', mode: 'illustrated', graphics: 0.15, beat: 5, music: 'cinematic-min',
    when: 'dramatic stories, space, nature, epic events, emotional turns',
    image: 'cinematic film still, anamorphic, volumetric light, rich shadows, shallow depth of field',
    rule: 'Mostly stills and motion clips; graphics only for one key number ("counter" or "kinetic").',
  },
  'kinetic-news': {
    label: 'Kinetic news', mode: 'mixed', graphics: 0.5, beat: 3.5, music: 'tech-pulse',
    when: 'breaking or trending stories, business and markets, fast facts, rankings',
    image: 'editorial news photo style, bold colour, punchy composition',
    rule: 'Half the beats are graphics ("stats", "counter", "bars", "versus", "kinetic"), cut fast; the rest stills or stock.',
  },
  'retro-vhs': {
    label: 'Retro VHS', mode: 'illustrated', graphics: 0.25, beat: 4, music: 'lofi-warm',
    when: '80s and 90s nostalgia, old tech, games, internet history',
    image: '1980s retro photo, VHS tape look, neon colours, film grain',
    rule: 'Stills plus "terminal", "chat" or "kinetic" graphics.',
  },
  anime: {
    label: 'Anime', mode: 'illustrated', graphics: 0.15, beat: 4, music: 'cinematic-min',
    when: 'heroic or emotional stories, Japan, games, fantasy',
    image: 'anime key visual, cel shading, vivid sky, expressive characters, studio-quality background art',
    rule: 'Mostly stills; a "kinetic" title for the hook.',
  },
  vlog: {
    label: 'Day-in-the-life vlog', mode: 'footage', graphics: 0.15, beat: 3.5, music: 'lofi-warm',
    when: 'a day in the life, routines, how people live or work, travel diaries',
    image: 'candid handheld phone photo, natural light, real everyday setting',
    rule: 'Real "stock" footage for everyday actions where it fits (max 4), otherwise candid stills; captions carry it.',
  },
  blueprint: {
    label: 'Blueprint tech', mode: 'motion-graphics', graphics: 0.8, beat: 4, music: 'tech-pulse',
    when: 'engineering, how machines and buildings work, architecture, inventions',
    image: 'technical blueprint drawing, white lines on blue, exploded view',
    rule: 'Most beats are graphics ("flow", "icons", "stats", "timeline"); the rest blueprint-style stills.',
  },
  'what-if': {
    label: 'What If animation', mode: 'scenes', render: 'bold-pop', graphics: 0, beat: 2.2, music: 'lofi-warm',
    when: 'what if hypotheticals and thought experiments ("what if you could...", "what would happen if..."), stick-figure cartoons',
    image: 'code-drawn stick-figure cartoon, dusk palette, warm rim light',
    rule: 'Every beat is a code-drawn "scene" beat starring Pip. No stills, no stock, no graphics.',
  },
  'bold-pop': {
    label: 'Bold pop', mode: 'mixed', graphics: 0.35, beat: 5, music: 'docu-pluck',
    when: 'general quick explainers when nothing else fits',
    image: 'moody cinematic photo, film grain',
    rule: 'Graphic beats where the script has numbers, steps or comparisons (about a third), never two in a row.',
  },
};
export const RECIPE_NAMES = Object.keys(RECIPES);
export const recipeMenu = () => RECIPE_NAMES.map((k) => `- "${k}" (${RECIPES[k].label}): ${RECIPES[k].when}`).join('\n');

// ---------- read format / length / style from the request itself ----------
const STYLE_WORDS = [
  [/what[\s-]?if (?:video|short|cartoon|animation|style|episode)|stick[\s-]?(?:figure|man)/i, 'what-if'],
  [/stop[\s-]?motion|claymation|clay\s*animation|felt animation|tabletop animation/i, 'stop-motion'],
  [/documentar|isaacverse|docu[\s-]?style|history channel|kings and generals|historical/i, 'documentary'],
  [/motion[\s-]?graphic|animated explainer|kurzgesagt|infographic|explainer animation|full animation|2d animation/i, 'motion-explainer'],
  [/blueprint|technical drawing|engineering style/i, 'blueprint'],
  [/cinematic|movie[\s-]?like|film look|epic/i, 'cinematic'],
  [/news style|kinetic|breaking news|fast[\s-]?paced/i, 'kinetic-news'],
  [/\bvhs\b|retro|80s|90s|synthwave/i, 'retro-vhs'],
  [/\banime\b|manga/i, 'anime'],
  [/\bvlog\b|day in (the|a) life|daily life/i, 'vlog'],
  [/\bwhat (?:if|would happen if|happens if)\b/i, 'what-if'],
];
export function parseJob(text) {
  const t = String(text || '');
  const job = {};
  let m = t.match(/(\d+(?:\.\d+)?)\s*(?:-|to)?\s*(?:min(?:ute)?s?|mins?\b|m\b)/i);
  if (m) job.length = Math.round(parseFloat(m[1]) * 60);
  else if ((m = t.match(/(\d{2,3})\s*(?:s\b|secs?\b|seconds?\b)/i))) job.length = parseInt(m[1], 10);
  else if (/half a minute/i.test(t)) job.length = 30;
  else if (/a minute long|one minute|1 minute/i.test(t)) job.length = 60;
  if (job.length) job.length = Math.max(15, Math.min(600, job.length));
  if (/youtube shorts?|\bshorts?\b|tiktok|reels?|9:16|vertical/i.test(t)) job.format = 'vertical';
  else if (/youtube|16:9|landscape|widescreen|horizontal/i.test(t)) job.format = 'landscape';
  else if (/square|1:1/i.test(t)) job.format = 'square';
  else if (/4:5|feed post/i.test(t)) job.format = 'portrait';
  for (const [re, name] of STYLE_WORDS) if (re.test(t)) { job.style = name; break; }
  if (job.length && job.length > 90 && !job.format) job.format = 'landscape';
  return job;
}
export const jobLabel = (job) => [job.style && RECIPES[job.style]?.label, job.format, job.length && `${job.length >= 60 ? (job.length / 60).toFixed(job.length % 60 ? 1 : 0) + ' min' : job.length + ' s'}`].filter(Boolean).join(' · ');

// ---------- graphics catalogue ----------
export const GRAPHIC_TYPES = ['counter', 'bars', 'line', 'list', 'title', 'terminal', 'versus', 'percent', 'pie', 'timeline', 'flow', 'quote', 'stats', 'myth', 'people', 'chat', 'kinetic', 'gauge', 'map', 'icons'];
export const GRAPHIC_DOCS = `  {"type": "counter", "value": 316661, "prefix": "$", "suffix": "", "label": "2-5 words"}  (one big number counting up)
  {"type": "bars", "title": "2-5 words", "prefix": "", "suffix": "%", "items": [{"label": "1-3 words", "value": 42}]}  (2 to 5 items compared)
  {"type": "line", "title": "2-5 words", "prefix": "", "suffix": "", "x_labels": ["first x", "last x"], "series": [{"label": "short", "values": [5 to 12 numbers, in order]}]}  (1 to 3 trends over time)
  {"type": "list", "title": "2-5 words", "items": ["2 to 4 items, max 5 words each"]}  (steps or reasons, revealed one by one)
  {"type": "title", "text": "2 to 5 punchy words", "sub": "optional short line"}  (kinetic words slamming in)
  {"type": "terminal", "title": "short window name", "lines": [{"kind": "cmd", "text": "a command"}, {"kind": "out | ok | warn | err | dim", "text": "an output line"}]}  (3-7 lines, max 42 chars; software, servers, coding)
  {"type": "versus", "title": "2-5 words", "prefix": "", "suffix": "", "left": {"label": "1-3 words", "value": 12, "sub": "optional 2-5 words"}, "right": {"label": "...", "value": 40}}  (two things face off; values optional)
  {"type": "percent", "value": 73, "label": "2-6 words"}  (a ring fills to a percentage 0-100)
  {"type": "pie", "title": "2-5 words", "suffix": "%", "items": [{"label": "1-3 words", "value": 60}]}  (2 to 5 shares of a whole)
  {"type": "timeline", "title": "2-5 words", "events": [{"date": "1971", "label": "max 6 words"}]}  (2 to 6 dated events in order)
  {"type": "flow", "title": "2-5 words", "steps": ["2 to 5 steps, max 5 words each"]}  (a process: step, arrow, step)
  {"type": "quote", "text": "a real quote from the research, max 25 words", "by": "who said it"}
  {"type": "stats", "title": "2-5 words", "items": [{"value": 4.2, "prefix": "", "suffix": "B", "label": "2-4 words"}]}  (2 to 4 number tiles)
  {"type": "myth", "myth": "the wrong belief, max 10 words", "fact": "the truth, max 12 words"}  (myth struck out, fact lands)
  {"type": "people", "value": 3, "total": 10, "label": "2-6 words"}  ("3 in 10 people..." icon grid; total 10 or 100)
  {"type": "chat", "title": "optional", "messages": [{"from": "them | me", "text": "max 12 words"}]}  (2 to 5 chat bubbles: dialogue, scams, texts)
  {"type": "kinetic", "words": ["2 to 6 short words or numbers"]}  (big words slamming in one by one: hooks, punchlines)
  {"type": "gauge", "value": 82, "min": 0, "max": 100, "suffix": "%", "label": "2-5 words"}  (a needle swings to a level)
  {"type": "map", "title": "2-5 words", "countries": ["Exact country names, e.g. Nigeria, United States of America, United Kingdom, China"], "label": "optional 3-8 words"}  (real world map, the countries light up; places and empires)
  {"type": "icons", "title": "2-5 words", "items": [{"icon": "lucide icon name, e.g. coins, landmark, ship, wheat, factory, smartphone, users, globe, shield, zap, heart, clock, truck, book", "label": "1-3 words"}]}  (2 to 6 icons: things, ideas, parts of a system)`;

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}]/gu;
const str = (v, n) => String(v ?? '').replace(EMOJI, '').replace(/\s+/g, ' ').trim().slice(0, n);
const num = (v) => (typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')));

/** The 14 newer graphic types (the first 6 stay in studio.mjs cleanGraphic). null = not drawable. */
export function cleanGraphic2(g) {
  const base = { prefix: str(g.prefix, 4), suffix: str(g.suffix, 6) };
  switch (g.type) {
    case 'versus': {
      const side = (x) => x && str(x.label, 24) ? { label: str(x.label, 24), ...(isFinite(num(x.value)) ? { value: num(x.value) } : {}), ...(x.sub ? { sub: str(x.sub, 40) } : {}) } : null;
      const l = side(g.left), r = side(g.right);
      return l && r ? { type: 'versus', title: str(g.title, 40), ...base, left: l, right: r } : null;
    }
    case 'percent': return isFinite(num(g.value)) ? { type: 'percent', value: Math.max(0, Math.min(100, num(g.value))), label: str(g.label, 44) } : null;
    case 'pie': {
      const items = (g.items || []).map((i) => ({ label: str(i?.label, 20), value: num(i?.value) })).filter((i) => i.label && isFinite(i.value) && i.value >= 0).slice(0, 5);
      return items.length >= 2 ? { type: 'pie', title: str(g.title, 40), suffix: g.suffix === undefined ? '%' : str(g.suffix, 6), items } : null;
    }
    case 'timeline': {
      const events = (g.events || []).map((e) => ({ date: str(e?.date, 14), label: str(e?.label, 44) })).filter((e) => e.date && e.label).slice(0, 6);
      return events.length >= 2 ? { type: 'timeline', title: str(g.title, 40), events } : null;
    }
    case 'flow': {
      const steps = (g.steps || []).map((x) => str(typeof x === 'string' ? x : x?.label, 34)).filter(Boolean).slice(0, 5);
      return steps.length >= 2 ? { type: 'flow', title: str(g.title, 40), steps } : null;
    }
    case 'quote': return str(g.text, 200) ? { type: 'quote', text: str(g.text, 200), by: str(g.by, 40) } : null;
    case 'stats': {
      const items = (g.items || []).map((i) => ({ value: num(i?.value), prefix: str(i?.prefix, 4), suffix: str(i?.suffix, 6), label: str(i?.label, 30) })).filter((i) => isFinite(i.value)).slice(0, 4);
      return items.length >= 2 ? { type: 'stats', title: str(g.title, 40), items } : null;
    }
    case 'myth': return str(g.myth, 80) && str(g.fact, 100) ? { type: 'myth', myth: str(g.myth, 80), fact: str(g.fact, 100) } : null;
    case 'people': {
      const total = [10, 20, 50, 100].includes(Math.round(num(g.total))) ? Math.round(num(g.total)) : 10;
      return isFinite(num(g.value)) ? { type: 'people', value: Math.max(0, Math.min(total, Math.round(num(g.value)))), total, label: str(g.label, 40) } : null;
    }
    case 'chat': {
      const messages = (g.messages || []).map((m) => ({ from: m?.from === 'me' ? 'me' : 'them', text: str(m?.text, 80) })).filter((m) => m.text).slice(0, 5);
      return messages.length >= 2 ? { type: 'chat', title: str(g.title, 30), messages } : null;
    }
    case 'kinetic': {
      const words = (Array.isArray(g.words) ? g.words : String(g.text || '').split(/\s+/)).map((w) => str(w, 18)).filter(Boolean).slice(0, 6);
      return words.length ? { type: 'kinetic', words } : null;
    }
    case 'gauge': {
      const min = isFinite(num(g.min)) ? num(g.min) : 0, max = isFinite(num(g.max)) ? num(g.max) : 100;
      return isFinite(num(g.value)) && max > min ? { type: 'gauge', value: Math.max(min, Math.min(max, num(g.value))), min, max, suffix: str(g.suffix, 6), label: str(g.label, 40) } : null;
    }
    case 'map': {
      const countries = (g.countries || []).map((c) => str(c, 50)).filter(Boolean).slice(0, 8);
      return countries.length ? { type: 'map', title: str(g.title, 40), countries, label: str(g.label, 60) } : null;
    }
    case 'icons': {
      const items = (g.items || []).map((i) => ({ icon: str(i?.icon, 30).toLowerCase(), label: str(i?.label, 24) })).filter((i) => i.icon && i.label).slice(0, 6);
      return items.length >= 2 ? { type: 'icons', title: str(g.title, 40), items } : null;
    }
    default: return null;
  }
}
export const stripEmoji = (s) => String(s ?? '').replace(EMOJI, '').replace(/\s{2,}/g, ' ').trim();

export function gfxLine2(g) {
  switch (g.type) {
    case 'versus': return `versus ${g.left.label} vs ${g.right.label}`;
    case 'percent': return `percent ring ${g.value}% ${g.label || ''}`;
    case 'pie': return `pie ${g.items.map((i) => `${i.label} ${i.value}${g.suffix || ''}`).join(' / ')}`;
    case 'timeline': return `timeline ${g.events.map((e) => e.date).join(' > ')}`;
    case 'flow': return `flow ${g.steps.join(' > ')}`;
    case 'quote': return `quote "${g.text.slice(0, 60)}"`;
    case 'stats': return `stats ${g.items.map((i) => `${i.prefix || ''}${i.value}${i.suffix || ''}`).join(' · ')}`;
    case 'myth': return `myth vs fact: ${g.myth}`;
    case 'people': return `people ${g.value} in ${g.total} ${g.label || ''}`;
    case 'chat': return `chat (${g.messages.length} messages)`;
    case 'kinetic': return `kinetic "${g.words.join(' ')}"`;
    case 'gauge': return `gauge ${g.value}${g.suffix || ''} ${g.label || ''}`;
    case 'map': return `map ${g.countries.join(', ')}`;
    case 'icons': return `icons ${g.items.map((i) => i.label).join(' / ')}`;
    default: return g.type;
  }
}

// ---------- how the director should mix graphics for a recipe / learned style ----------
export function graphicRule(name, learned) {
  if (learned) {
    const r = learned.graphic_ratio ?? 0.3;
    if (r >= 0.85) return RECIPES['motion-explainer'].rule;
    if (r >= 0.5) return `About ${Math.round(r * 100)}% of beats are graphic beats (vary the type, back-to-back graphics are fine); the rest pictures.`;
    return `About ${Math.max(10, Math.round(r * 100))}% of beats are graphic beats, never two in a row, never the first beat.`;
  }
  return (RECIPES[name] || RECIPES['bold-pop']).rule;
}

/** Beats and words for a length. Long videos get more, shorter-feeling beats grouped into chapters. */
export function plan(lengthS, beatS) {
  const L = Math.max(15, lengthS || 45);
  const per = Math.max(2.5, Math.min(9, beatS || (L > 90 ? 6 : 5)));
  const beats = Math.max(5, Math.min(48, Math.round(L / per)));
  return { length: L, beats, min: Math.max(4, beats - 2), max: beats + 2, words: Math.round(L * 2.5), chapters: L >= 100 ? Math.max(3, Math.min(6, Math.round(L / 45))) : 0 };
}


// ---------- What If pack (stage 3): the director picks code-drawn scenes by name + parameters ----------
// Keep these lists in step with WHATIF_CATALOG in shorts-studio remotion/src/packs/whatif/SceneBeat.tsx.
export const WHATIF = {
  scenes: ['title', 'demo', 'fact'],
  shots: ['wide', 'medium', 'close', 'insert'],
  rooms: ['desk', 'kitchen', 'street'],
  moods: ['dusk', 'night'],
  poses: ['idle', 'reach', 'hold', 'point', 'shock', 'think', 'wave', 'walk'],
  props: ['cookie', 'laptop', 'cup', 'phone', 'bulb', 'clock', 'box', 'coin'],
  focus: ['pip', 'prop', 'window', 'light'],
};
const wiPick = (v, list, d) => { const x = String(v ?? '').toLowerCase().trim(); return list.includes(x) ? x : d; };
const wiInt = (v, lo, hi) => { const n = num(v); return isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : undefined; };

/** 15 to 25 seconds, one picture about every 2.2 s, 45 to 65 words (the formula's shape). */
export function whatifPlan(lengthS) {
  const L = Math.max(15, Math.min(25, Math.round(Number(lengthS) || 22)));
  const beats = Math.round(L / 2.2);
  return { length: L, beats, min: Math.max(8, beats - 1), max: beats + 2, words: Math.max(45, Math.min(65, Math.round(L * 2.6))), chapters: 0 };
}

export const WHATIF_RULES = `Writing rules for a "What If" cartoon (never break):
- Second person, present tense, short sentences (3 to 8 words). Every line is a picture: if it needs a caption to be understood, rewrite it.
- The power has a word. Say that word in every demo (for example "Copy. Paste.").
- The seven-beat formula, folded into 15 to 25 seconds: (1) cold open: three quick demos of the power, escalating from small and selfish, to useful, to slightly uncanny; (2) the premise: one title beat that says "What if you could ...?" and one rule; (3) one fun line, one more escalation; (4) the turn: the cost, ONE real fact with a number taken from the RESEARCH notes, then the words "That's real."; (5 to 7) the last line leaves a question or a threat open. Never end on a resolution.
- Never invent a number. If the research has no real number for the cost, make the turn a plain consequence and use no fact beat.
- Banned: the "not X, but Y" pattern, em dashes, "here's the thing", "let that sink in", "the truth is", "delve", "unlock", "game-changer", emojis, hashtags.
- Original premise and original character only (Pip). Never copy a channel's title or hero.`;

/** Swap the generic script prompt for the What If one: its rules, and a beat shape with a scene object instead of an image prompt. */
export function whatifScript(script, rules, mode = 'full') {
  return String(script).replace(rules, mode === 'none' ? WHATIF_RULES_STORY : WHATIF_RULES)
    .replace(/"image_prompt":[\s\S]*?"query": "[^"]*"/, '"tool": "scene", "scene": "the scene object, see the director rules"');
}

export const whatifDocs = () => `shots ${WHATIF.shots.join('/')}, rooms ${WHATIF.rooms.join('/')}, moods ${WHATIF.moods.join('/')}, poses ${WHATIF.poses.join('/')}, props ${WHATIF.props.join('/')}, focus ${WHATIF.focus.join('/')}`;

export const whatifDirector = (off = '', mode = 'full') => `You are also the director. This video is a code-drawn What If cartoon starring Pip, a stick figure. EVERY beat uses tool "scene" (never flux, stock, graphic, pixellab or higgsfield) and carries a "scene" object, exactly one of:
  {"scene": "title", "title": ["WHAT IF YOU COULD", "COPY AND PASTE ANYTHING?"], "rule": "one rule, max 6 words"}  (the premise card: exactly one per video, right after the cold open; 1 to 3 lines in capitals, max 28 characters each)
  {"scene": "demo", "shot": "wide | medium | close | insert", "room": "desk | kitchen | street", "mood": "dusk | night", "pose": "...", "from": "...", "prop": "...", "action": "max 3 words", "x": -80, "x_to": 160, "focus": "pip | prop | window | light"}  (Pip acting; every field except "scene" is optional)
  {"scene": "fact", "number": "13 min", "label": "max 6 words"}  (the one real number of the turn; the number is spoken in that beat)
Allowed values: ${whatifDocs()}.
Rules:
- ONE room and ONE mood for the whole video: choose the room that fits the story and use it in every demo.
- Change the shot size on EVERY cut, never the same size twice in a row. Wide to establish, insert on the prop or hand (an insert needs a "prop"), medium for action, close on the face for a reaction.
- A beat is one picture of about 2 seconds, so its narration is 3 to 8 words. "pose" is the pose Pip ends in; use "from" only for a change of pose (idle to shock).
- "prop" is what Pip holds and must be what the narration is about.
- Walking only in wide or medium shots: "pose" "walk", "from" "walk", x and x_to between -300 and 300, at most 450 apart. Otherwise leave x out.
- "action" is a tiny readout like "copy" or "paste". Use it on at most 3 beats.
- No image_prompt, no emojis, no text in the scene except the title and fact fields.
${mode === 'none' ? '- No fact beat: this is a story, not a research video.\n' : ''}${off}`;

/** Clean one scene object from the model. Returns null if it cannot be drawn. */
export function cleanScene(g) {
  if (!g || typeof g !== 'object') return null;
  const kind = wiPick(g.scene, WHATIF.scenes, '');
  if (kind === 'title') {
    const raw = Array.isArray(g.title) ? g.title : String(g.title || '').split(/\n|\|/);
    const title = raw.map((x) => str(x, 28).toUpperCase()).filter(Boolean).slice(0, 3);
    const rule = str(g.rule, 44);
    return title.length ? { pack: 'whatif', scene: 'title', title, ...(rule ? { rule } : {}) } : null;
  }
  if (kind === 'fact') {
    const number = str(g.number, 12);
    return number ? { pack: 'whatif', scene: 'fact', number, label: str(g.label, 44) } : null;
  }
  if (kind !== 'demo') return null;
  const o = { pack: 'whatif', scene: 'demo', shot: wiPick(g.shot, WHATIF.shots, 'medium'), room: wiPick(g.room, WHATIF.rooms, 'desk'), mood: wiPick(g.mood, WHATIF.moods, 'dusk') };
  const pose = wiPick(g.pose, WHATIF.poses, ''), from = wiPick(g.from, WHATIF.poses, ''), prop = wiPick(g.prop, WHATIF.props, '');
  if (pose) o.pose = pose;
  if (from) o.from = from;
  if (prop) o.prop = prop;
  const action = str(g.action, 24);
  if (action) o.action = action;
  const x = wiInt(g.x, -300, 300), xt = wiInt(g.x_to, -300, 300);
  if (xt !== undefined && xt !== (x ?? -200)) {
    // safe walking: stays well inside the room, never a long sprint, always the walk pose, never a close-up
    o.x = x ?? -200;
    o.x_to = Math.max(-300, Math.min(300, Math.abs(xt - o.x) > 450 ? o.x + Math.sign(xt - o.x) * 450 : xt));
    o.pose = 'walk';
    o.from = 'walk';
    if (o.shot === 'close' || o.shot === 'insert') o.shot = 'medium';
  } else if (x !== undefined) o.x = x;
  const focus = wiPick(g.focus, WHATIF.focus, '');
  if (focus) o.focus = focus;
  const seed = wiInt(g.seed, 0, 9);
  if (seed !== undefined) o.seed = seed;
  if (o.shot === 'insert' && !o.prop) o.shot = 'close';
  return o;
}

/** Whole-video rules on cleaned beats: one room, one mood, one title card, a new shot size on every cut. Mutates. */
export function finishWhatIfBeats(beats) {
  const tally = (k) => beats.filter((b) => b.scene?.scene === 'demo').reduce((m, b) => { m[b.scene[k]] = (m[b.scene[k]] || 0) + 1; return m; }, {});
  const top = (m, d) => Object.entries(m).sort((a, b) => b[1] - a[1])[0]?.[0] || d;
  const room = top(tally('room'), 'desk'), mood = top(tally('mood'), 'dusk');
  const order = ['wide', 'medium', 'insert', 'close'];
  let titles = 0, prev = '';
  for (const b of beats) {
    if (b.scene.scene === 'title' && ++titles > 1) b.scene = { pack: 'whatif', scene: 'demo', shot: 'medium', room, mood };
    const t = b.scene;
    if (t.scene !== 'demo') { prev = ''; continue; }
    t.room = room;
    t.mood = mood;
    if (t.shot === prev) {
      const alt = order.find((x) => x !== prev && (x !== 'insert' || t.prop) && (t.x_to === undefined || (x !== 'close' && x !== 'insert')));
      if (alt) t.shot = alt;
    }
    prev = t.shot;
  }
  return beats;
}

export function sceneLine(s) {
  if (!s) return 'scene';
  if (s.scene === 'title') return `title card "${(s.title || []).join(' ')}"`;
  if (s.scene === 'fact') return `fact card ${s.number || ''} ${s.label || ''}`.trim();
  return `${s.shot || 'medium'} shot, ${s.room || 'desk'}${s.pose ? ', ' + s.pose : ''}${s.prop ? ', holding ' + s.prop : ''}`;
}

export const whatifPitchNote = (job = {}, learned = null) => (learned || (job.style && job.style !== 'what-if')) ? ''
  : '\nIf you choose the "what-if" style: it is a 15 to 25 second stick-figure cartoon. The hook is the cold open (the power in action), the angle is "What if you could ...?" plus one rule, key_facts must include ONE real fact with a number about the cost of the power, and length_seconds is 15 to 25.';

// ---------- Research modes (stage 3b): not every video is a research video ----------
// 'none'  = the user's own story or experience, or fiction: no search, no fact check, nothing added from outside.
// 'light' = What If: one search, no deep browser research, no retry on the hypothetical lines.
// 'full'  = discovery / explainer videos: research, fact check, deep research (as before).
export function researchMode(text, style) {
  const t = String(text || '');
  if (/\b(no research|don'?t research|do not research|without research|skip (the )?research|no fact[\s-]?check|story ?time|(my|our) (own )?(story|experience|journey|life)|happened to me|true story|personal story|(sharing|share|tell) (my|a|an|the) (story|experience)|fiction|made[\s-]?up|i (went|was|had|got|lost|met|lived|worked|tried|learned|used to|started|quit))\b/i.test(t)) return 'none';
  return style === 'what-if' ? 'light' : 'full';
}

/** The writing rules for the user's own story: nothing from outside, no research notes to lean on. */
export function storyScript(script) {
  return String(script).replace(/- Every fact, name, number and date must come from[^\n]*/,
    "- This is the user's own story or experience, not a research video. Use only what they told you in the request. Invent no outside facts, statistics, names or dates, and add no fact check. Keep their voice and their details.");
}

export const storyPitchNote = (job = {}) => job.research === 'none'
  ? "\nThis is the user's own story or experience, not a research topic. There are no research notes. Use only what the user said; do not add outside facts, numbers or names. key_facts = the 3 to 5 moments of their story, in order."
  : '';

export const WHATIF_RULES_STORY = WHATIF_RULES.split('\n').map((l) => l.startsWith('- The seven-beat') ? l.replace(/\(4\) the turn:.*?then the words "That's real\."/, '(4) the turn: the catch, a plain consequence with no numbers') : l.startsWith('- Never invent a number') ? "- This is the user's own idea or story: use only what they told you. Invent no outside facts, numbers or names." : l).join('\n');

// ==== LEARNED-STYLES BRIDGE (style-fix) - re-exports the durable store; safe to remove ====
export { learnedList, learnedGet, learnedMatch, applyLearnedToSpec } from './_learned_styles.mjs';
// ==== END LEARNED-STYLES BRIDGE (style-fix) ====