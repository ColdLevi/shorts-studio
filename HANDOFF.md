# HANDOFF — ColdLevi bot platform (Browser agent + Shorts Studio + LLM proxy)

_Last updated: 2026-10-22 20:50 WAT. Give this whole file to any LLM agent before asking it to continue._

## 0. Rules for the next agent
- The owner works **only from an Android phone in Termux (zsh)**. Give **all steps numbered in one message**, copy-paste ready. zsh: unmatched globs abort a command (use `grep -r --include` or `setopt nonomatch`). If pastes show `[200~`, add `unset zle_bracketed_paste` to `~/.zshrc`.
- Always `git pull --rebase origin main` before editing or pushing: GitHub Actions commits back to `main` (library.json, media/, state/). A rejected push = pull --rebase then push.
- Prefer **patch-style installers** (`install.py`, idempotent, prints done / already done / NOT FOUND, `--dry-run`) over replacing whole files — several upgrades patch the same files.
- Never claim a run worked without the log. Never print or commit secrets. Free tools first; ask before anything that costs money.
- Vercel deploy from Termux: `export NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection"` before `vercel --prod` ("fetch failed" = phone network; also fixed once by updating ca-certificates).

## 1. The three pieces
| Piece | Where | What it is |
|---|---|---|
| **LLM proxy** | `~/llm-proxy` (NOT a git repo; deploy only with `vercel --prod`). Vercel project `michael-calebs-projects/llm-proxy`, live at `https://llm-proxy-one-rose.vercel.app` (Hobby plan, ~12 function cap) | OpenAI-style `/api/v1/chat/completions` with Gemini → Groq → OpenRouter fallback (model `smart` tries GEMINI_SMART_MODEL / gemini-3.5-flash / gemini-2.5-flash first), `/api/v1/search` (Gemini grounding), `/api/v1/youtube` (YouTube Data API), `/api/v1/video` (Gemini watches a YouTube video: picture + sound), `/api/v1/memory` (shared "hive" memory), `api/telegram.mjs` (browser bot webhook), `api/studio.mjs` (Shorts Studio bot brain), `api/studio-app.mjs` (Telegram Mini App), `api/_timeline.mjs` (edit-patch engine), fixer files `api/_fixer.mjs`, `api/_fixer_rules.mjs`, `api/fixer.mjs`, live-render `api/_live.mjs` |
| **Browser agent bot** (Telegram `@mrbrowseragent_bot`) | GitHub `ColdLevi/Browser-agent-bot`, local `~/browser-agent-project` | General assistant. Webhook → proxy `api/telegram.mjs` → `repository_dispatch run-browser-agent` → GitHub Actions runs `router.py` (modes chat / ask / research / browser / deep) + `agent.py` (browser-use 0.13.11) + `toolbox.py` (tool loop, 10 steps) + `deep.py` |
| **Shorts Studio bot** (separate Telegram bot) | GitHub `ColdLevi/shorts-studio` (public, free Actions minutes), local `~/shorts-studio`. Old kit at `~/studio` | Makes faceless shorts. Bot brain lives in proxy `api/studio.mjs`; renders run in `.github/workflows/make-short.yml` (`repository_dispatch make-short` / `render-project`) |

The two bots talk **only through the proxy** (owner's decision). Studio dispatch secrets live in Vercel env, not in the browser-bot repo.

## 2. Secrets / env (names only — values are on Vercel/GitHub)
- **Vercel (llm-proxy):** `PROXY_KEY` (rotated 2026-10-22, stored as hidden Secret; owner keeps a copy at `~/.proxy_key`), `GEMINI_API_KEY`, `GROQ_API_KEY`, OpenRouter key, `YT_API_KEY`, `TELEGRAM_TOKEN` (browser bot), `ALLOWED_CHAT_ID`, `GH_TOKEN`, `GH_REPO=ColdLevi/Browser-agent-bot`, `STUDIO_TG_TOKEN`, `STUDIO_TOKEN` (PAT on shorts-studio: Contents/PRs/Actions read-write), `STUDIO_REPO`, `STUDIO_CHAT_ID`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, optional `TTS_VOICE` (default en-NG-AbeoNeural), optional `STUDIO_APP_LOCK=1`.
- **GitHub Browser-agent-bot:** `PROXY_URL`, `PROXY_KEY` (**must be updated to the new value**), `TELEGRAM_TOKEN`, `FIXER_CHAT_ID`.
- **GitHub shorts-studio:** `TELEGRAM_TOKEN` (studio bot), `CHAT_ID`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `HF_TOKEN` (Hugging Face, `hf_…`; old slot `HF_API_KEY_ID` also accepted), `PROXY_URL=https://llm-proxy-one-rose.vercel.app/api/v1`, `PROXY_KEY`, optional `PIXELLAB_API_KEY`, `GEMINI_API_KEY`. Repo variable optional `FIXER_AUTO_MERGE=true`. Actions settings: read-write + allow Actions to create PRs.
- ⚠️ Browser bot Telegram token was pasted in chat once → **revoke via BotFather `/revoke`**, update Vercel `TELEGRAM_TOKEN`, re-run webhook setup (allowed updates: message, callback_query).

## 3. Browser agent — what's built
- Router chat-first; web-intent override → research; refusal detector; today's date in prompts; free_search fallback (Bing/Google News RSS).
- Tools: web_search, news, read_page, youtube_lookup, watch_video (via proxy `/video`, never answer from description), calculate, currency, weather, ask_user (Telegram form), use_browser (last resort), final_answer.
- `brain/core.md` rulebook, `skills/*/SKILL.md` + `skillbook.py`, 👍 → `/learn`, 👎 → `/feedback` → `rules.json`. Commands: `/skills`, `/skill add|remove`, `/rules`, `/new`, `/memory`, `/forget`.
- Voice: Groq Whisper in, edge-tts out via optional "Speak back" button.
- Session continuity: `session.json`, Chrome profile cached, `memory.json`, `lessons.json`.
- **Hive memory:** `hive.json` on a `hive` branch; shared chat log per chat, kv job state; both bots read/write it. "make a short about X" hands off to studio (`/api/studio?handoff=1`).
- **Deep mode (deep-agent.zip):** "pull every video from that channel" → lists uploads (≤150) → Gemini watches each → progress every 5 → `continue` resumes → report + .md. Blocks fake "I'm pulling…" promises. Workflow timeout 330 min. **Status: delivered, install not confirmed.** Verify: `grep -c "import deep" router.py` = 1.

## 4. Shorts Studio — what's built (and live)
- Flow: `/short <topic>` (or 4 researched idea buttons) → pitch → fact-checked script → director picks a tool per shot → approve → GitHub render → MP4 to Telegram + library in Mini App.
- Tools per shot: Cloudflare FLUX (flux-2-klein-9b hook, -4b others, flux-1-schnell fallback; no `seed` param), PixelLab (pixel art, paid, optional), **motion = Hugging Face Wan 2.2** ZeroGPU Space `zerogpu-aoti/wan2-2-fp8da-aoti-faster` `/generate_video` via gradio_client (free ~5 GPU min/day). **Higgsfield removed** (internal tool id `higgsfield` kept only as alias). Remotion graphics for charts/titles.
- Voice: edge-tts with 3 retries + 2 safe voices, then **gTTS backup** (estimated word timings). Fixed the `NoAudioReceived` failure.
- **Engine step 1 (live):** universal Remotion renderer, any canvas/fps, saved project timelines (`media/projects/<id>/timeline.json`, versions), `/reformat 16:9`, `/captions neon`.
- **Engine step 2 (pushed 16d5f87, deployed):** chat re-editing ("swap scene 3 for a rocket launch") → validated JSON patch → Apply/Cancel → only changed assets remade. `/scenes /history /undo /restore <n> /project /edit`. Edit queue survives failed renders 45 min. Old pre-step-1 shorts can't be edited. Live edit test not yet reported.
- Last confirmed run: project `linux-power-on-your-phone-mvjwhdps`, voice 35.3 s, 7 visuals, rendered.

## 5. Packages delivered today (all in owner's Downloads)
| Zip | Status |
|---|---|
| video-engine-step1.zip | installed, live |
| video-engine-step2.zip (includes TTS fix) | installed, live |
| ttsfix.zip v2 | superseded by step 2 zip / pushed |
| hfmotion.zip v2 (remove Higgsfield) | delivered; confirm pushed + `vercel --prod` + `HF_TOKEN` secret |
| fixer-agent.zip (self-healing fixer) | shorts-studio part pushed (9466410); confirm browser-agent-project push, secrets, step 16 live check |
| miniapp-render.zip (live "Watch it build" render view) | delivered, not installed |
| deep-agent.zip | delivered, install not confirmed |

**Self-healing fixer:** on any failed workflow → classify: temporary (retry once with backoff), missing secret (Telegram note + Retry), code bug (LLM search/replace patch on `fix/<run_id>`, runs checks/tests, PR + Telegram Approve/Reject). Caps: 80 lines / 3 files, 2 tries, auto-revert, never touches `.env`/secrets/`.github`. Proxy crashes reported to `/api/fixer?report=1`. Proxy code mirrored to `browser-agent-project/proxy-src` (if `--mirror-proxy`); after approving a proxy fix run `bash ~/fixer/pull-proxy.sh`; after hand-editing proxy run `bash ~/fixer/sync-proxy.sh`.

**Live render Mini App:** `tools/progress.py` posts stage/pct/items (waveform, 240px thumbs, Remotion frame progress) to `studio-app.mjs?live=1`; state on `studio-live` branch; bot adds "▶ Watch it build" web_app button.

## 6. Next steps, in order
1. Put new `PROXY_KEY` into GitHub secrets of **both** repos (`gh secret set PROXY_KEY < ~/.proxy_key`), test the browser bot replies.
2. Finish hfmotion (push, `vercel --prod`, add `HF_TOKEN`), make a new `/short`, look for "hugging face motion ok" in the log.
3. Install miniapp-render.zip (14 steps in its INSTALL.md), tap Watch it build.
4. Live-test step 2 edits: `/scenes`, an edit, Apply, `/history`, `/undo`.
5. Finish fixer install on browser-agent-project + live check (INSTALL.md step 16).
6. Install/verify deep-agent.zip; test with the ShipWeb3 YouTube channel.
7. Revoke the exposed browser-bot Telegram token.
8. Proposed, not built: **Hugging Face toolbox** for the bots (FLUX/Qwen-Image, Qwen-Image-Edit, Wan/LTX video, Qwen3-TTS, YarnGPT2 Nigerian voice on own CPU Space, Chatterbox cloning, Whisper captions, MusicGen, MMAudio SFX, background removal, upscalers, LatentSync, PP-OCR) with fallbacks. Note: HF removed free Inference Providers credit on 2026-10-07; free = ZeroGPU Spaces (5 min/day) + CPU Spaces.
9. Proposed: put the whole workstation (both bots, editor, fixer approvals) into one Telegram Mini App.

## 7. Known gotchas
- GitHub runner IPs get captcha'd by YouTube/Bing → use proxy research/video endpoints, not the browser, for info.
- Gemini `/search` once returned empty (router logs `search failed <code>`).
- Remotion can't run on the phone — renders happen on GitHub Actions.
- Telegram webhook for browser bot: `https://llm-proxy-one-rose.vercel.app/api/telegram`; refresh studio menu with `<proxy>/api/studio?setup=1`.
- Vercel Hobby route cap: add routes inside existing files (query-param routes), not new files.
