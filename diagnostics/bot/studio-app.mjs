// Shorts Studio mini app (opens inside Telegram). GET -> page, GET ?data=1 -> library.json from the shorts-studio repo.
export default async function handler(req, res) {
  if (req.query?.data) {
    const r = await fetch(`https://api.github.com/repos/${process.env.STUDIO_REPO}/contents/library.json`, {
      headers: { Authorization: 'Bearer ' + process.env.STUDIO_TOKEN, Accept: 'application/vnd.github.raw+json', 'User-Agent': 'shorts-studio-app' },
    });
    res.setHeader('Cache-Control', 'no-store');
    if (!r.ok) return res.status(200).json({ shorts: [] });
    try { return res.status(200).json(JSON.parse(await r.text())); } catch (e) { return res.status(200).json({ shorts: [] }); }
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(PAGE);
}

const PAGE = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<title>Shorts Studio</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
:root{--bg:#07070b;--card:#13131c;--text:#f4f1ea;--muted:#8d8a99;--accent:#FFD43B;--ease:cubic-bezier(.22,1,.36,1)}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
html,body{background:var(--bg);color:var(--text);font-family:-apple-system,"SF Pro Display","Segoe UI",Roboto,sans-serif;overflow-x:hidden}
body{min-height:100vh;padding:max(18px,env(safe-area-inset-top)) 16px 40px}
.glow{position:fixed;inset:-30% -30% auto;height:70vh;pointer-events:none;z-index:0;
 background:radial-gradient(40% 50% at 30% 40%,rgba(255,212,59,.22),transparent 70%),radial-gradient(35% 45% at 75% 30%,rgba(90,169,255,.18),transparent 70%);
 filter:blur(30px);animation:drift 14s ease-in-out infinite alternate}
@keyframes drift{to{transform:translate3d(6%,8%,0) scale(1.15)}}
header{position:relative;z-index:1;margin:6px 4px 22px;opacity:0;animation:rise .9s var(--ease) .05s forwards}
.eyebrow{font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:var(--accent);font-weight:700}
h1{font-size:34px;line-height:1.05;font-weight:800;letter-spacing:-.02em;margin-top:8px}
h1 span{background:linear-gradient(90deg,#fff,var(--accent));-webkit-background-clip:text;background-clip:text;color:transparent}
.sub{color:var(--muted);font-size:14px;margin-top:8px}
.stats{display:flex;gap:10px;margin-top:16px}
.stat{flex:1;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:12px 14px;backdrop-filter:blur(12px)}
.stat b{display:block;font-size:22px}.stat small{color:var(--muted);font-size:12px}
.grid{position:relative;z-index:1;display:grid;grid-template-columns:1fr 1fr;gap:12px}
.card{position:relative;aspect-ratio:9/16;border-radius:20px;overflow:hidden;background:var(--card);cursor:pointer;
 opacity:0;transform:translateY(26px) scale(.96);animation:rise .8s var(--ease) forwards;box-shadow:0 18px 40px -18px rgba(0,0,0,.8);
 transition:transform .35s var(--ease)}
.card:active{transform:scale(.97)}
.card img{width:100%;height:100%;object-fit:cover;transform:scale(1.04);transition:transform 6s ease}
.card:hover img{transform:scale(1.12)}
.card::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 45%,rgba(0,0,0,.88))}
.card .meta{position:absolute;left:12px;right:12px;bottom:12px;z-index:2}
.card .t{font-weight:700;font-size:15px;line-height:1.2;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.card .d{color:#cfcbd8;font-size:11px;margin-top:6px}
.play{position:absolute;top:12px;right:12px;z-index:2;width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.16);backdrop-filter:blur(10px);display:grid;place-items:center}
.play::before{content:"";margin-left:3px;border-left:11px solid #fff;border-top:7px solid transparent;border-bottom:7px solid transparent}
.new{position:absolute;top:12px;left:12px;z-index:2;font-size:10px;font-weight:800;letter-spacing:.12em;padding:5px 8px;border-radius:99px;background:var(--accent);color:#111}
@keyframes rise{to{opacity:1;transform:none}}
.skel{aspect-ratio:9/16;border-radius:20px;background:linear-gradient(110deg,#12121a 30%,#1d1d29 50%,#12121a 70%);background-size:200% 100%;animation:shimmer 1.3s linear infinite}
@keyframes shimmer{to{background-position:-200% 0}}
.empty{position:relative;z-index:1;text-align:center;padding:60px 20px;color:var(--muted);opacity:0;animation:rise .8s var(--ease) .2s forwards}
.empty .big{font-size:56px;display:block;margin-bottom:12px;animation:float 3s ease-in-out infinite}
@keyframes float{50%{transform:translateY(-8px)}}
/* player */
.player{position:fixed;inset:0;z-index:10;background:#000;display:flex;align-items:center;justify-content:center;
 opacity:0;pointer-events:none;transition:opacity .35s ease}
.player.open{opacity:1;pointer-events:auto}
.stage{position:relative;width:100%;height:100%;transform-origin:center;transition:transform .55s var(--ease),border-radius .55s var(--ease);overflow:hidden}
.player video{width:100%;height:100%;object-fit:contain;background:#000}
.top{position:absolute;left:0;right:0;top:0;padding:max(14px,env(safe-area-inset-top)) 14px 40px;background:linear-gradient(#000a,transparent);display:flex;justify-content:space-between;align-items:center;z-index:3}
.btn{border:0;color:#fff;background:rgba(255,255,255,.14);backdrop-filter:blur(14px);border-radius:99px;padding:9px 14px;font-size:14px;font-weight:600}
.bottom{position:absolute;left:0;right:0;bottom:0;padding:50px 18px max(22px,env(safe-area-inset-bottom));background:linear-gradient(transparent,#000d);z-index:3}
.bottom h2{font-size:20px;line-height:1.2;transform:translateY(12px);opacity:0;transition:all .6s var(--ease) .15s}
.bottom p{color:#d5d1de;font-size:13px;margin-top:6px;transform:translateY(12px);opacity:0;transition:all .6s var(--ease) .25s}
.player.open .bottom h2,.player.open .bottom p{transform:none;opacity:1}
.bar{height:3px;background:rgba(255,255,255,.2);border-radius:3px;margin-top:14px;overflow:hidden}
.bar i{display:block;height:100%;width:0;background:var(--accent);border-radius:3px}
.actions{display:flex;gap:8px;margin-top:14px}
.hint{position:absolute;right:14px;top:50%;z-index:3;color:#fff8;font-size:11px;writing-mode:vertical-rl;letter-spacing:.2em}
.tap{position:absolute;inset:0;z-index:2;display:grid;place-items:center;pointer-events:none}
.tap span{width:74px;height:74px;border-radius:50%;background:rgba(0,0,0,.45);opacity:0;transform:scale(.6);transition:all .3s var(--ease);display:grid;place-items:center}
.tap span::before{content:"";margin-left:6px;border-left:24px solid #fff;border-top:15px solid transparent;border-bottom:15px solid transparent}
.paused .tap span{opacity:1;transform:none}
.slide-up{animation:slideUp .45s var(--ease)}.slide-down{animation:slideDown .45s var(--ease)}
@keyframes slideUp{from{transform:translateY(40%);opacity:0}}@keyframes slideDown{from{transform:translateY(-40%);opacity:0}}
</style></head>
<body>
<div class="glow"></div>
<header>
  <div class="eyebrow">Shorts Studio</div>
  <h1>Your <span>shorts</span>,<br>ready to post.</h1>
  <p class="sub" id="sub">Loading your library…</p>
  <div class="stats"><div class="stat"><b id="n">–</b><small>shorts made</small></div><div class="stat"><b id="m">–</b><small>minutes of video</small></div></div>
</header>
<main class="grid" id="grid"><div class="skel"></div><div class="skel"></div><div class="skel"></div><div class="skel"></div></main>

<div class="player" id="player">
  <div class="stage" id="stage">
    <video id="vid" playsinline webkit-playsinline preload="auto"></video>
    <div class="tap"><span></span></div>
    <div class="top"><button class="btn" id="close">✕ Close</button><button class="btn" id="count"></button></div>
    <div class="hint">SWIPE ↕</div>
    <div class="bottom"><h2 id="pt"></h2><p id="ph"></p><div class="bar"><i id="prog"></i></div>
      <div class="actions"><button class="btn" id="dl">⬇ Download</button><button class="btn" id="share">↗ Share link</button></div></div>
  </div>
</div>

<script>
const tg = window.Telegram && Telegram.WebApp;
if (tg) { tg.ready(); tg.expand(); try { tg.setHeaderColor('#07070b'); tg.setBackgroundColor('#07070b'); } catch(e){} }
const haptic = (t='light') => { try { tg.HapticFeedback.impactOccurred(t) } catch(e){} };
let shorts = [], idx = 0;
const $ = (id) => document.getElementById(id);
const fmt = (ts) => new Date(ts).toLocaleDateString(undefined,{day:'numeric',month:'short'});

async function boot(){
  try { shorts = ((await (await fetch(location.pathname + '?data=1')).json()).shorts || []).sort((a,b)=>b.created-a.created); } catch(e){ shorts = []; }
  $('n').textContent = shorts.length;
  $('m').textContent = (shorts.reduce((s,x)=>s+(x.duration||0),0)/60).toFixed(1);
  $('sub').textContent = shorts.length ? 'Tap one to play. Swipe up for the next.' : 'Nothing rendered yet.';
  const g = $('grid'); g.innerHTML = '';
  if (!shorts.length) { g.outerHTML = '<div class="empty"><span class="big">🎬</span>Your finished shorts appear here.<br>Send /short &lt;topic&gt; in the chat to make the first one.</div>'; return; }
  shorts.forEach((s,i) => {
    const c = document.createElement('div'); c.className = 'card'; c.style.animationDelay = (0.08*i + .15) + 's';
    c.innerHTML = (i===0 && Date.now()-s.created < 864e5 ? '<span class="new">NEW</span>' : '') + '<div class="play"></div>' +
      (s.poster ? '<img loading="lazy" src="'+s.poster+'" alt="">' : '') +
      '<div class="meta"><div class="t"></div><div class="d">'+fmt(s.created)+' · '+Math.round(s.duration||0)+'s</div></div>';
    c.querySelector('.t').textContent = s.title;
    c.onclick = () => open(i, c);
    g.appendChild(c);
  });
}

function load(i, dir){
  idx = (i + shorts.length) % shorts.length; const s = shorts[idx]; const v = $('vid');
  v.src = s.url; if (s.poster) v.poster = s.poster;
  $('pt').textContent = s.title; $('ph').textContent = s.hook || ''; $('count').textContent = (idx+1) + ' / ' + shorts.length;
  if (s.accent) document.documentElement.style.setProperty('--accent', s.accent);
  const st = $('stage'); st.classList.remove('slide-up','slide-down'); void st.offsetWidth; if (dir) st.classList.add(dir>0?'slide-up':'slide-down');
  v.play().catch(()=>$('player').classList.add('paused'));
}

function open(i, card){
  haptic('medium');
  const r = card.getBoundingClientRect(), st = $('stage');
  st.style.transition = 'none';
  st.style.transform = 'translate('+(r.left+r.width/2-innerWidth/2)+'px,'+(r.top+r.height/2-innerHeight/2)+'px) scale('+(r.width/innerWidth)+')';
  st.style.borderRadius = '40px';
  $('player').classList.add('open'); load(i, 0);
  requestAnimationFrame(()=>requestAnimationFrame(()=>{ st.style.transition=''; st.style.transform='none'; st.style.borderRadius='0'; }));
  if (tg) { tg.BackButton.show(); tg.BackButton.onClick(close); }
}
function close(){
  const v = $('vid'); v.pause(); $('player').classList.remove('open','paused');
  if (tg) { tg.BackButton.hide(); tg.BackButton.offClick(close); }
  setTimeout(()=>{ v.removeAttribute('src'); v.load(); }, 350);
}
$('close').onclick = close;
const v = $('vid');
v.addEventListener('timeupdate', ()=>{ $('prog').style.width = (v.currentTime/(v.duration||1)*100)+'%'; });
v.addEventListener('ended', ()=>{ if (shorts.length>1) load(idx+1, 1); else { v.currentTime=0; v.play(); } });
$('stage').addEventListener('click', (e)=>{ if (e.target.closest('.btn')) return; if (v.paused){ v.play(); $('player').classList.remove('paused'); } else { v.pause(); $('player').classList.add('paused'); } haptic(); });
let y0 = null;
$('stage').addEventListener('touchstart', e=>{ y0 = e.touches[0].clientY; }, {passive:true});
$('stage').addEventListener('touchend', e=>{ if (y0===null) return; const dy = e.changedTouches[0].clientY - y0; y0 = null;
  if (Math.abs(dy) > 70 && shorts.length > 1) { haptic('light'); load(idx + (dy<0?1:-1), dy<0?1:-1); } });
const go = (u) => tg ? tg.openLink(u) : window.open(u);
$('dl').onclick = ()=>{ haptic(); go(shorts[idx].url); };
$('share').onclick = ()=>{ haptic(); const u = shorts[idx].url; tg ? tg.openTelegramLink('https://t.me/share/url?url='+encodeURIComponent(u)+'&text='+encodeURIComponent(shorts[idx].title)) : navigator.clipboard.writeText(u); };
boot();
</script>
</body></html>`;
