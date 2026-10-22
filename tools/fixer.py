#!/usr/bin/env python3
"""Self-healing fixer for the bot repos (shorts-studio, Browser-agent-bot, and the llm-proxy mirror).

Runs inside .github/workflows/fixer.yml when a watched workflow fails (workflow_run) or when the
llm-proxy reports a crash (repository_dispatch fix-request). It:
  1. collects the failing job's last ~150 log lines, the files the traceback points at, and the recent diff;
  2. classifies the failure: transient (re-run once with backoff), config (tell the user which secret),
     code (ask the LLM for a minimal search/replace fix, apply it on fix/<run_id>, run checks, open a PR,
     send Telegram Approve / Reject buttons; auto-merge only if FIXER_AUTO_MERGE is true);
  3. guards: never touches secrets/.env/workflow secret lines/fixer files/paths outside the repo, caps the patch
     size, max 2 fix attempts per error signature, auto-reverts a merged fix whose next run fails, never runs on
     its own failures.
State lives in fixer_state.json on the `fixer-state` branch (contents API), shared with llm-proxy/api/_fixer.mjs.

Local use:  python3 tools/fixer.py classify <logfile>     (prints the classification, no network)
"""
import base64, difflib, glob, hashlib, json, os, py_compile, re, shutil, subprocess, sys, tempfile, time
import urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get("FIXER_ROOT") or os.path.abspath(os.path.join(HERE, ".."))
STATE_BRANCH = "fixer-state"
STATE_FILE = "fixer_state.json"
OWN_WORKFLOW = "Fixer"
LOG_LINES = 150

DEFAULT_CFG = {
    "repo_key": "s", "bot_name": "Shorts Studio", "FIXER_AUTO_MERGE": False, "max_attempts": 2,
    "max_patch_lines": 80, "max_files": 3, "max_backoff": 300, "proxy_src": "",
    # .github/* is protected because GITHUB_TOKEN may not push workflow changes (no `workflows` scope); a workflow
    # bug is reported to you instead of patched.
    "protected": [".env", ".env.*", "*.env", "*.pem", "*.key", "**/secrets*", "secrets*", ".git/*", ".github/*",
                  ".github/workflows/fixer.yml", "tools/fixer.py", "tools/fixer_rules.json",
                  "fixer_config.json", "fixer_state.json", "state/*", "media/*", "library.json"],
}
SECRET_LITERAL = re.compile(r"ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|gsk_[A-Za-z0-9]{20,}|\b\d{8,10}:[A-Za-z0-9_-]{30,}\b")


def load_cfg(root=None):
    root = root or ROOT
    cfg = dict(DEFAULT_CFG)
    p = os.path.join(root, "fixer_config.json")
    if os.path.exists(p):
        try:
            cfg.update(json.load(open(p)))
        except Exception as e:
            print("fixer_config.json unreadable:", e)
    env = os.environ.get("FIXER_AUTO_MERGE", "").strip().lower()
    if env in ("true", "1", "yes"):
        cfg["FIXER_AUTO_MERGE"] = True
    elif env in ("false", "0", "no"):
        cfg["FIXER_AUTO_MERGE"] = False
    return cfg


def load_rules(path=None):
    return json.load(open(path or os.path.join(HERE, "fixer_rules.json")))


# ---------------------------------------------------------------- log + classify
GH_PREFIX = re.compile(r"^[^\t\n]*\t[^\t\n]*\t(?:\ufeff)?\d{4}-\d\d-\d\dT[\d:.]+Z ?")
ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
GENERIC = re.compile(r"Process completed with exit code|^##\[(?:group|endgroup)\]|^\s*$")
ERRORISH = re.compile(r"(?:Error|Exception|NoAudioReceived|error:|ERR!|fatal:|^E: |failed|Failed|Unauthorized|Forbidden|denied|timed out|not set|missing|Too Many Requests|429|5\d\d)", re.M)


def clean_log(raw, n=LOG_LINES):
    """gh --log-failed lines are '<job>\\t<step>\\t<timestamp> <text>'. Returns (text, failing_step)."""
    out, step = [], ""
    for ln in str(raw or "").splitlines():
        m = GH_PREFIX.match(ln)
        if m:
            parts = ln.split("\t", 2)
            step = parts[1] if len(parts) > 2 else step
            ln = ln[m.end():]
        ln = ANSI.sub("", ln).replace("##[error]", "").rstrip()
        out.append(ln)
    return "\n".join(out[-n:]), step


def focus_lines(text):
    """Unindented lines that look like the actual error (the last ones matter most). Code lines that Python
    prints inside a traceback are indented, so they never count as the error."""
    lines = [l for l in text.splitlines() if l and not l.startswith("    ") and not GENERIC.search(l) and ERRORISH.search(l)]
    return lines[-6:]


def _rx(rule):
    return re.compile(rule["pattern"], 0 if rule.get("case") else re.I | re.M)


def _match(kind, text, rules):
    for r in rules.get(kind, []):
        m = _rx(r).search(text)
        if m:
            return r, m
    return None, None


def classify(text, rules=None):
    """Returns {kind: transient|config|code|unknown, rule, label, backoff, secret, line}."""
    rules = rules or load_rules()
    focus = focus_lines(text)
    ftext = "\n".join(focus)
    last = focus[-1] if focus else (text.strip().splitlines() or [""])[-1]
    res = None
    for scope in (ftext, text):
        for kind in ("config", "transient"):
            r, m = _match(kind, scope, rules)
            if r:
                res = {"kind": kind, "rule": r["id"], "label": r.get("label", ""), "backoff": r.get("backoff", 0)}
                if kind == "config":
                    res["secret"] = m.group(r["secret_group"]) if r.get("secret_group") else r.get("secret", "")
                break
        if res:
            break
        if scope is ftext:
            r, _ = _match("code", ftext, rules)
            if r:
                r, _ = _match("code", text, rules)  # the error line is code; name it from the whole log (traceback etc.)
                res = {"kind": "code", "rule": r["id"], "label": r.get("label", "")}
                break
    if not res:
        r, _ = _match("code", text, rules)
        res = {"kind": "code", "rule": r["id"], "label": r.get("label", "")} if r else {"kind": "unknown", "rule": "", "label": "unrecognised failure"}
    res["line"] = last.strip()[:300]
    return res


def normalise(line):
    s = re.sub(r"https?://\S+", "<url>", line)
    s = re.sub(r"(/[\w.-]+)+/", "", s)
    s = re.sub(r"0x[0-9a-f]+|\b[0-9a-f]{7,40}\b", "<h>", s, flags=re.I)
    s = re.sub(r"\d+", "#", s)
    return re.sub(r"\s+", " ", s).strip()[:200]


def signature(cls, files=()):
    top = files[0][0] if files else ""
    return hashlib.sha1(f"{cls['kind']}|{normalise(cls.get('line', ''))}|{top}".encode()).hexdigest()[:12]


# ---------------------------------------------------------------- referenced files
PY_FRAME = re.compile(r'File "([^"]+)", line (\d+)')
JS_FRAME = re.compile(r"(?:file://)?((?:/|[A-Za-z]:)?[\w./-]+\.(?:mjs|cjs|js|ts|tsx|py)):(\d+)(?::\d+)?")


def to_rel(path, root, proxy_src=""):
    p = path.replace("\\", "/")
    if "/site-packages/" in p or "/node_modules/" in p or "/hostedtoolcache/" in p or p.startswith("node:"):
        return None
    ws = os.environ.get("GITHUB_WORKSPACE", "")
    cands = []
    if ws and p.startswith(ws.rstrip("/") + "/"):
        cands.append(p[len(ws.rstrip("/")) + 1:])
    m = re.search(r"/home/runner/work/[^/]+/[^/]+/(.+)$", p)
    if m:
        cands.append(m.group(1))
    m = re.search(r"/var/task/(.+)$", p)
    if m and proxy_src:
        cands.append(proxy_src.rstrip("/") + "/" + m.group(1))
    if proxy_src:
        m = re.search(r"(?:^|/)(api/.+)$", p)
        if m:
            cands.append(proxy_src.rstrip("/") + "/" + m.group(1))
    if not p.startswith("/"):
        cands.append(re.sub(r"^(?:\./)+", "", p))
    for c in cands:
        full = os.path.realpath(os.path.join(root, c))
        if full.startswith(os.path.realpath(root) + os.sep) and os.path.isfile(full):
            return os.path.relpath(full, root)
    return None


def referenced_files(text, root, proxy_src="", limit=4):
    """[(rel_path, [line numbers])], deepest frame first."""
    hits = []
    for rx in (PY_FRAME, JS_FRAME):
        for m in rx.finditer(text):
            rel = to_rel(m.group(1), root, proxy_src)
            if rel:
                hits.append((m.start(), rel, int(m.group(2))))
    hits.sort()
    order, lines = [], {}
    for _, rel, ln in reversed(hits):
        if rel not in lines:
            order.append(rel)
            lines[rel] = []
        if ln not in lines[rel]:
            lines[rel].append(ln)
    return [(r, sorted(lines[r])) for r in order[:limit]]


def excerpt(root, rel, lines, full_limit=450, ctx=60):
    src = open(os.path.join(root, rel), errors="replace").read()
    rows = src.splitlines()
    if len(rows) <= full_limit:
        return f"=== {rel} (full file, {len(rows)} lines; error at line(s) {lines}) ===\n{src}"
    keep = set()
    for ln in lines or [1]:
        keep.update(range(max(1, ln - ctx), min(len(rows), ln + ctx) + 1))
    parts, prev = [], None
    for i in sorted(keep):
        if prev is not None and i != prev + 1:
            parts.append("[... lines skipped ...]")
        parts.append(rows[i - 1])
        prev = i
    return f"=== {rel} (EXCERPT of {len(rows)} lines around {lines}; copy search text exactly from here) ===\n" + "\n".join(parts)


# ---------------------------------------------------------------- guardrails + patch
def protected(rel, cfg):
    rel = rel.replace("\\", "/")
    import fnmatch
    name = os.path.basename(rel)
    for pat in cfg.get("protected", []):
        if fnmatch.fnmatch(rel, pat) or fnmatch.fnmatch(name, pat) or fnmatch.fnmatch(rel, pat.replace("**/", "*/")):
            return True
    return False


def safe_path(root, rel):
    if not rel or os.path.isabs(rel) or ".." in rel.replace("\\", "/").split("/"):
        return None
    full = os.path.realpath(os.path.join(root, rel))
    if not full.startswith(os.path.realpath(root) + os.sep):
        return None
    return full


def plan_edits(edits, root, cfg, allowed_prefix=""):
    """Validate LLM edits. Returns ({rel: new_text}, {rel: old_text}, changed_lines) or raises ValueError."""
    if not isinstance(edits, list) or not edits:
        raise ValueError("no edits proposed")
    new, old = {}, {}
    for e in edits:
        rel = re.sub(r"^(?:\./)+", "", str(e.get("file", "")).strip())
        search, replace = e.get("search"), e.get("replace")
        if not isinstance(search, str) or not isinstance(replace, str) or not search:
            raise ValueError(f"bad edit for {rel!r}")
        full = safe_path(root, rel)
        if not full:
            raise ValueError(f"path outside the repo: {rel!r}")
        if protected(rel, cfg):
            raise ValueError(f"protected file: {rel}")
        if allowed_prefix and not rel.startswith(allowed_prefix):
            raise ValueError(f"{rel} is outside {allowed_prefix}")
        if not os.path.isfile(full):
            raise ValueError(f"file does not exist: {rel}")
        if os.path.getsize(full) > 400_000:
            raise ValueError(f"file too big to patch: {rel}")
        if SECRET_LITERAL.search(replace):
            raise ValueError("the fix contains something that looks like a secret")
        if rel.startswith(".github/workflows/") and ("secrets." in search or "secrets." in replace or "${{ secrets" in replace):
            raise ValueError("workflow secret lines are off limits")
        if rel not in new:
            old[rel] = open(full, errors="replace").read()
            new[rel] = old[rel]
        n = new[rel].count(search)
        if n != 1:
            raise ValueError(f"search text found {n} times in {rel} (must be exactly once)")
        new[rel] = new[rel].replace(search, replace, 1)
    if len(new) > cfg["max_files"]:
        raise ValueError(f"fix touches {len(new)} files (cap {cfg['max_files']})")
    changed = 0
    for rel in new:
        for d in difflib.unified_diff(old[rel].splitlines(), new[rel].splitlines(), lineterm="", n=0):
            if (d.startswith("+") or d.startswith("-")) and not d.startswith(("+++", "---")):
                changed += 1
        if rel.startswith(".github/workflows/"):
            before = [l for l in old[rel].splitlines() if "secrets." in l]
            after = [l for l in new[rel].splitlines() if "secrets." in l]
            if before != after:
                raise ValueError("workflow secret lines are off limits")
    if changed == 0:
        raise ValueError("the edits change nothing")
    if changed > cfg["max_patch_lines"]:
        raise ValueError(f"fix changes {changed} lines (cap {cfg['max_patch_lines']})")
    return new, old, changed


def unified(old, new):
    out = []
    for rel in new:
        out += difflib.unified_diff(old[rel].splitlines(True), new[rel].splitlines(True), "a/" + rel, "b/" + rel)
    return "".join(out)


# ---------------------------------------------------------------- checks
def discover_tests(root):
    t = sorted(set(glob.glob(os.path.join(root, "tests", "test_*.py")) + glob.glob(os.path.join(root, "tests", "*_test.py"))))
    j = sorted(glob.glob(os.path.join(root, "tests", "*.test.mjs")) + glob.glob(os.path.join(root, "tests", "*.test.js")))
    return [os.path.relpath(p, root) for p in t + j]


def run_tests(io, root, tests):
    res = {}
    for t in tests:
        cmd = ["node", t] if t.endswith((".mjs", ".js")) else [sys.executable, "-B", t]  # -B: no stale .pyc
        code, out = io.sh(cmd, cwd=root, timeout=240)
        res[t] = (code == 0, out[-1500:])
    return res


def syntax_checks(io, root, files):
    errs = []
    for rel in files:
        full = os.path.join(root, rel)
        if rel.endswith(".py"):
            try:
                py_compile.compile(full, doraise=True, cfile=os.path.join(tempfile.gettempdir(), "fx_pyc"))
            except py_compile.PyCompileError as e:
                errs.append(f"{rel}: {e.msg[-400:]}")
        elif rel.endswith((".mjs", ".js", ".cjs")):
            code, out = io.sh(["node", "--check", rel], cwd=root, timeout=60)
            if code != 0:
                errs.append(f"{rel}: {out[-400:]}")
        elif rel.endswith(".json"):
            try:
                json.load(open(full))
            except Exception as e:
                errs.append(f"{rel}: {e}")
        elif rel.endswith((".yml", ".yaml")):
            try:
                import yaml  # PyYAML is on GitHub runners; skip quietly elsewhere
                yaml.safe_load(open(full))
            except ImportError:
                pass
            except Exception as e:
                errs.append(f"{rel}: {e}")
    return errs


def apply_and_check(io, root, new, old, baseline):
    """Writes the new files, runs syntax checks + tests. Restores the old files and returns (False, why) on failure."""
    for rel, txt in new.items():
        open(os.path.join(root, rel), "w").write(txt)
        shutil.rmtree(os.path.join(root, os.path.dirname(rel), "__pycache__"), ignore_errors=True)
    errs = syntax_checks(io, root, list(new))
    report = []
    if not errs and baseline:
        after = run_tests(io, root, list(baseline))
        for t, (ok_before, _) in baseline.items():
            ok_after, out = after[t]
            if ok_before and not ok_after:
                errs.append(f"test {t} passed before the fix and fails after it:\n{out[-800:]}")
            report.append(f"{t}: {'pass' if ok_after else ('fail (already failing before)' if not ok_before else 'FAIL')}")
    if errs:
        for rel, txt in old.items():
            open(os.path.join(root, rel), "w").write(txt)
        return False, "\n".join(errs)
    return True, "; ".join(report) or "syntax checks passed (no tests in tests/)"


# ---------------------------------------------------------------- IO (real); tests replace this class
class IO:
    def __init__(self):
        self.repo = os.environ.get("GITHUB_REPOSITORY", "")
        self.token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN", "")

    def http(self, method, url, body=None, headers=None, timeout=60):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json", "User-Agent": "fixer", **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                t = r.read().decode() or "{}"
                return r.status, (json.loads(t) if t.strip().startswith(("{", "[")) else {"raw": t})
        except urllib.error.HTTPError as e:
            t = e.read().decode(errors="replace")
            try:
                return e.code, json.loads(t)
            except Exception:
                return e.code, {"raw": t[:500]}
        except Exception as e:
            return 0, {"error": str(e)}

    def gh(self, method, path, body=None):
        return self.http(method, "https://api.github.com/repos/" + self.repo + path, body,
                         {"Authorization": "Bearer " + self.token, "Accept": "application/vnd.github+json"})

    def sh(self, cmd, cwd=None, timeout=120):
        try:
            p = subprocess.run(cmd, cwd=cwd or ROOT, capture_output=True, text=True, timeout=timeout)
            return p.returncode, (p.stdout or "") + (p.stderr or "")
        except subprocess.TimeoutExpired:
            return 124, "timed out"
        except FileNotFoundError as e:
            return 127, str(e)

    def tg(self, method, body):
        tok = os.environ.get("TELEGRAM_TOKEN", "")
        if not tok or not body.get("chat_id"):
            print("[telegram skipped]", body.get("text", ""))
            return {}
        _, d = self.http("POST", f"https://api.telegram.org/bot{tok}/{method}", body, timeout=30)
        return d

    def llm(self, messages):
        """llm-proxy first (same Gemini -> Groq -> OpenRouter chain the bots use), then the provider keys directly."""
        body = {"messages": messages, "temperature": 0.1, "response_format": {"type": "json_object"}}
        tries = []
        if os.environ.get("PROXY_URL") and os.environ.get("PROXY_KEY"):
            base = os.environ["PROXY_URL"].rstrip("/")
            base = base if base.endswith("/api/v1") else base + "/api/v1"
            tries.append((base + "/chat/completions", os.environ["PROXY_KEY"], {"model": "smart"}))
            tries.append((base + "/chat/completions", os.environ["PROXY_KEY"], {}))
        if os.environ.get("GEMINI_API_KEY"):
            tries.append(("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", os.environ["GEMINI_API_KEY"], {"model": "gemini-2.5-flash"}))
        if os.environ.get("GROQ_API_KEY"):
            tries.append(("https://api.groq.com/openai/v1/chat/completions", os.environ["GROQ_API_KEY"], {"model": "openai/gpt-oss-120b"}))
        errs = []
        for url, key, extra in tries:
            code, d = self.http("POST", url, {**body, **extra}, {"Authorization": "Bearer " + key}, timeout=120)
            if code == 200 and d.get("choices"):
                return d["choices"][0]["message"].get("content") or ""
            errs.append(f"{url.split('/')[2]} {code}")
        raise RuntimeError("no LLM answered: " + (", ".join(errs) or "no PROXY_URL/PROXY_KEY or GEMINI_API_KEY secret"))

    def sleep(self, s):
        time.sleep(s)


# ---------------------------------------------------------------- state (fixer-state branch)
class State:
    def __init__(self, io):
        self.io, self.sha, self.data = io, None, {}

    def ensure_branch(self):
        code, _ = self.io.gh("GET", f"/git/ref/heads/{STATE_BRANCH}")
        if code == 200:
            return
        code, repo = self.io.gh("GET", "")
        base = (repo or {}).get("default_branch", "main")
        code, ref = self.io.gh("GET", f"/git/ref/heads/{base}")
        if code == 200:
            self.io.gh("POST", "/git/refs", {"ref": f"refs/heads/{STATE_BRANCH}", "sha": ref["object"]["sha"]})

    def load(self):
        code, f = self.io.gh("GET", f"/contents/{STATE_FILE}?ref={STATE_BRANCH}")
        if code == 200 and f.get("content"):
            self.sha = f["sha"]
            try:
                self.data = json.loads(base64.b64decode(f["content"]).decode())
            except Exception:
                self.data = {}
        else:
            self.sha, self.data = None, {}
        for k in ("signatures", "fixes", "retries", "notified", "reports"):
            self.data.setdefault(k, {})
        return self.data

    def save(self, msg="fixer state [skip ci]"):
        self.ensure_branch()
        for _ in range(4):
            body = {"message": msg, "branch": STATE_BRANCH,
                    "content": base64.b64encode(json.dumps(self.data, indent=1, sort_keys=True).encode()).decode()}
            if self.sha:
                body["sha"] = self.sha
            code, d = self.io.gh("PUT", f"/contents/{STATE_FILE}", body)
            if code in (200, 201):
                self.sha = d.get("content", {}).get("sha")
                return True
            if code not in (409, 422):
                print("state save failed", code, str(d)[:200])
                return False
            mine = self.data
            self.load()
            self.data = merge_state(self.data, mine)
        return False


def merge_state(theirs, mine):
    out = json.loads(json.dumps(theirs))
    for k in ("signatures", "fixes", "retries", "notified", "reports"):
        out.setdefault(k, {})
        for key, v in (mine.get(k) or {}).items():
            o = out[k].get(key)
            if isinstance(v, dict) and isinstance(o, dict):
                out[k][key] = v if v.get("updated", 0) >= o.get("updated", 0) else o
            elif isinstance(v, (int, float)) and isinstance(o, (int, float)):
                out[k][key] = max(v, o)
            else:
                out[k][key] = v
    return out


# ---------------------------------------------------------------- telegram text
def _btns(rows):
    return {"inline_keyboard": rows}


def notify(io, cfg, text, buttons=None):
    body = {"chat_id": os.environ.get("FIXER_CHAT_ID", ""), "text": text[:3500], "disable_web_page_preview": True}
    if buttons:
        body["reply_markup"] = _btns(buttons)
    d = io.tg("sendMessage", body) or {}
    return (d.get("result") or {}).get("message_id")


def run_link(io, run_id):
    return f"https://github.com/{io.repo}/actions/runs/{run_id}" if str(run_id).isdigit() else ""


# ---------------------------------------------------------------- LLM fix
SYSTEM = """You fix one failing CI job with the smallest possible code change.
Return JSON only: {"summary": "<= 12 plain words: what the fix does", "cause": "<= 20 plain words: what broke",
 "edits": [{"file": "repo-relative path", "search": "exact text copied from the file, enough lines to be unique", "replace": "new text"}],
 "confidence": 0.0-1.0}
Rules:
- Only edit files shown to you. Never create or delete files. Keep the change minimal (a few lines); no refactors, no reformatting.
- "search" must match the file text exactly once, including indentation. Copy it from the file, not from the traceback.
- Never touch secrets, tokens, .env files, `secrets.` lines in workflows, or the fixer itself. Never hard-code keys.
- If the failure is not a code bug (network, outage, quota, missing secret) or you are not sure, return {"edits": [], "summary": "no safe fix", "cause": "..."}.
- Prefer defensive fixes at the crash site (a missing key -> sensible default, a None -> guard) over changing behaviour elsewhere."""


def ask_fix(io, ctx, cls, files_txt, diff_txt, extra=""):
    user = (f"Workflow: {ctx.get('workflow', '')}  Step: {ctx.get('step', '')}\nClassified as: {cls['kind']} ({cls['label']})\n"
            f"Error line: {cls['line']}\n\n--- LAST LOG LINES ---\n{ctx['log'][-9000:]}\n\n--- FILES ---\n{files_txt[:45000]}\n\n"
            f"--- RECENT COMMITS ---\n{diff_txt[:8000]}\n{extra}")
    raw = io.llm([{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}])
    t = raw.strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    if not t.startswith("{"):
        a, b = t.find("{"), t.rfind("}")
        t = t[a:b + 1] if a >= 0 else "{}"
    try:
        return json.loads(t)
    except Exception:
        return {"edits": [], "summary": "no safe fix", "cause": "the model answered with invalid JSON"}


# ---------------------------------------------------------------- GitHub actions helpers
def redispatch(io, trigger, ctx):
    """Re-start the failed job on the NEW code. Returns a short plain description."""
    t = trigger or {}
    if t.get("event") == "repository_dispatch" and t.get("action"):
        code, _ = io.gh("POST", "/dispatches", {"event_type": t["action"], "client_payload": t.get("client_payload") or {}})
        return "re-sent the same request" if code == 204 else f"could not re-send it (GitHub {code})"
    if t.get("event") == "workflow_dispatch" and ctx.get("workflow_path"):
        wf = os.path.basename(ctx["workflow_path"])
        code, _ = io.gh("POST", f"/actions/workflows/{wf}/dispatches", {"ref": t.get("ref") or "main", "inputs": t.get("inputs") or {}})
        return "re-ran it with the same inputs" if code == 204 else f"could not re-run it (GitHub {code})"
    if str(ctx.get("run_id", "")).isdigit():
        code, _ = io.gh("POST", f"/actions/runs/{ctx['run_id']}/rerun-failed-jobs")
        return "re-ran the old run (it uses the old code; the next new run gets the fix)" if code == 201 else f"could not re-run (GitHub {code})"
    return "the next run will use it"


def get_trigger(io, run_id):
    d = tempfile.mkdtemp(prefix="fxtrig")
    code, _ = io.sh(["gh", "run", "download", str(run_id), "-n", "fixer-trigger", "-D", d, "-R", io.repo], timeout=60)
    p = os.path.join(d, "fixer-trigger.json")
    if code == 0 and os.path.exists(p):
        try:
            return json.load(open(p))
        except Exception:
            return None
    return None


def git(io, *args, timeout=120):
    return io.sh(["git", *args], cwd=ROOT, timeout=timeout)


def merge_pr(io, number, title):
    code, d = io.gh("PUT", f"/pulls/{number}/merge", {"merge_method": "squash", "commit_title": title})
    if code == 405:
        io.gh("PUT", f"/pulls/{number}/update-branch", {})
        io.sleep(5)
        code, d = io.gh("PUT", f"/pulls/{number}/merge", {"merge_method": "squash", "commit_title": title})
    return (d.get("sha") if code == 200 else None), code


def revert_fix(io, state, fix_id, fix, ctx, cfg):
    sha = fix.get("merged_sha")
    branch = f"revert/{fix_id}"
    base = fix.get("base_branch", "main")
    git(io, "fetch", "--quiet", "origin", base)
    git(io, "fetch", "--quiet", "--depth=2", "origin", sha)  # the checkout is shallow; get the fix commit + its parent
    steps = [git(io, "checkout", "-B", branch, f"origin/{base}"), git(io, "revert", "--no-edit", sha),
             git(io, "push", "-f", "origin", branch)]
    if any(c != 0 for c, _ in steps):
        git(io, "revert", "--abort")
        return None, "git revert failed: " + " | ".join(o[-200:] for c, o in steps if c != 0)
    code, pr = io.gh("POST", "/pulls", {"title": f"Revert fixer: {fix.get('summary', '')}", "head": branch, "base": base,
                                       "body": f"Auto-revert: run {ctx.get('run_id')} of {ctx.get('workflow')} failed after fix #{fix.get('pr')} was merged."})
    if code != 201:
        return None, f"could not open the revert PR (GitHub {code})"
    merged, mcode = merge_pr(io, pr["number"], f"Revert \"fixer: {fix.get('summary', '')}\" (#{pr['number']})")
    io.gh("DELETE", f"/git/refs/heads/{branch}")
    return (pr["number"] if merged else None), ("" if merged else f"revert PR #{pr['number']} opened but not merged (GitHub {mcode})")


def check_merged_fixes(io, state, ctx, cls, cfg):
    """Auto-revert: a merged fix whose next run of the same workflow fails (not a transient blip) is undone.
    Returns True when a revert happened (stop there)."""
    if not ctx.get("created_at"):
        return False
    for fid, fx in list(state.data["fixes"].items()):
        if fx.get("status") != "merged" or fx.get("workflow") != ctx.get("workflow") or fx.get("target") == "llm-proxy":
            continue
        if not fx.get("merged_at") or fx["merged_at"] > ctx["created_at"]:
            continue
        wf = os.path.basename(ctx.get("workflow_path") or "")
        q = urllib.parse.quote(">=" + fx["merged_at"])
        code, d = io.gh("GET", f"/actions/workflows/{wf}/runs?status=success&per_page=5&created={q}") if wf else (0, {})
        if code == 200 and d.get("total_count", 0) > 0:
            fx.update(status="verified", updated=time.time())
            continue
        if cls["kind"] == "transient":
            continue
        num, err = revert_fix(io, state, fid, fx, ctx, cfg)
        fx.update(status="reverted" if num else "revert_failed", revert_pr=num, updated=time.time())
        state.save()
        if num:
            notify(io, cfg, f"↩️ {cfg['bot_name']}: the next run still failed after fix #{fx.get('pr')}, so I undid it (PR #{num}).\n"
                            f"Error now: {cls['line'][:160]}\nLog: {run_link(io, ctx['run_id'])}")
        else:
            notify(io, cfg, f"⚠️ {cfg['bot_name']}: fix #{fx.get('pr')} did not help and I could not undo it myself ({err}). "
                            f"Revert it on GitHub: https://github.com/{io.repo}/pull/{fx.get('pr')}")
        return True
    return False


# ---------------------------------------------------------------- main flow
def should_skip(event_name, event):
    """Loop guard. Returns a reason string to skip, or ''."""
    if event_name == "workflow_run":
        wr = event.get("workflow_run") or {}
        if wr.get("name") == OWN_WORKFLOW or (wr.get("path") or "").endswith("/fixer.yml"):
            return "the fixer never handles its own runs"
        if wr.get("conclusion") != "failure":
            return f"conclusion is {wr.get('conclusion')}"
        hb = wr.get("head_branch") or ""
        if hb.startswith(("fix/", "revert/", STATE_BRANCH)):
            return f"run on fixer branch {hb}"
        return ""
    if event_name == "repository_dispatch":
        if event.get("action") != "fix-request":
            return "not a fix-request"
        p = event.get("client_payload") or {}
        if "_fixer" in str(p.get("stack", "")) or "fixer.py" in str(p.get("stack", "")):
            return "error came from the fixer itself"
        return ""
    return f"event {event_name} not handled"


def build_ctx(io, event_name, event, cfg):
    if event_name == "workflow_run":
        wr = event["workflow_run"]
        code, raw = io.sh(["gh", "run", "view", str(wr["id"]), "--log-failed", "-R", io.repo], timeout=120)
        if code != 0 or not raw.strip():
            code, raw = io.sh(["gh", "run", "view", str(wr["id"]), "--log", "-R", io.repo], timeout=120)
        log, step = clean_log(raw)
        return {"run_id": str(wr["id"]), "attempt": int(wr.get("run_attempt") or 1), "workflow": wr.get("name", ""),
                "workflow_path": wr.get("path", ""), "created_at": wr.get("created_at", ""), "head_sha": wr.get("head_sha", ""),
                "base_branch": (event.get("repository") or {}).get("default_branch", "main"),
                "log": log, "step": step, "target": "repo", "trigger": get_trigger(io, wr["id"])}
    p = event.get("client_payload") or {}
    rid = os.environ.get("GITHUB_RUN_ID", str(int(time.time())))
    text = f"{p.get('message', '')}\n{p.get('stack', '')}"
    return {"run_id": "p" + rid, "attempt": 1, "workflow": f"llm-proxy {p.get('source', '')}".strip(), "workflow_path": "",
            "created_at": "", "base_branch": (event.get("repository") or {}).get("default_branch", "main"),
            "log": text[-12000:], "step": p.get("file", ""), "target": "llm-proxy" if cfg.get("proxy_src") else "repo",
            "trigger": None, "reported_sig": p.get("signature", ""), "source": p.get("source", "")}


def handle(io, event_name, event, cfg=None, rules=None):
    cfg = cfg or load_cfg()
    rules = rules or load_rules()
    why = should_skip(event_name, event)
    if why:
        print("skip:", why)
        return {"action": "skip", "why": why}
    ctx = build_ctx(io, event_name, event, cfg)
    cls = classify(ctx["log"], rules)
    files = referenced_files(ctx["log"], ROOT, cfg.get("proxy_src", ""))
    if ctx["target"] == "llm-proxy":
        files = [f for f in files if f[0].startswith(cfg["proxy_src"])]
    sig = signature(cls, files)
    state = State(io)
    state.load()
    what = f"{ctx['workflow']}" + (f" ({ctx['step']})" if ctx.get("step") else "")
    link = run_link(io, ctx["run_id"])
    print(json.dumps({"class": cls, "signature": sig, "files": files}, indent=1))

    if check_merged_fixes(io, state, ctx, cls, cfg):
        return {"action": "reverted", "class": cls}

    # ---- transient: one re-run with backoff, no code change
    if cls["kind"] == "transient":
        if ctx["target"] == "llm-proxy":
            return {"action": "ignore-transient", "class": cls}
        if ctx["attempt"] >= 2 or state.data["retries"].get(ctx["run_id"], 0) >= 1:
            notify(io, cfg, f"⚠️ {cfg['bot_name']}: {what} failed again after a retry.\nWhy: {cls['label']}.\n"
                            f"Probably still down on their side; no code change. Log: {link}",
                   [[{"text": "🔁 Retry once more", "callback_data": f"fx:r:{cfg['repo_key']}:{ctx['run_id']}"}]])
            return {"action": "gave-up-transient", "class": cls}
        wait = min(int(cls.get("backoff") or 30), int(cfg["max_backoff"]))
        state.data["retries"][ctx["run_id"]] = 1
        state.save()
        notify(io, cfg, f"🔁 {cfg['bot_name']}: {what} failed.\nWhy: {cls['label']} (temporary).\nFix: re-running it once in {wait}s. No code change.")
        io.sleep(wait)
        code, _ = io.gh("POST", f"/actions/runs/{ctx['run_id']}/rerun-failed-jobs")
        if code != 201:
            notify(io, cfg, f"⚠️ Could not re-run it (GitHub {code}). Log: {link}")
        return {"action": "rerun", "class": cls, "wait": wait, "status": code}

    # ---- config: tell the user which secret, no code change
    if cls["kind"] == "config":
        last = state.data["notified"].get(sig, 0)
        if time.time() - float(last or 0) < 6 * 3600:
            return {"action": "config-already-told", "class": cls}
        state.data["notified"][sig] = time.time()
        state.save()
        secret = cls.get("secret") or "a secret"
        where = f"https://github.com/{io.repo}/settings/secrets/actions"
        btn = [[{"text": "🔁 Retry after adding it", "callback_data": f"fx:r:{cfg['repo_key']}:{ctx['run_id']}"}]] if str(ctx["run_id"]).isdigit() else None
        notify(io, cfg, f"🔑 {cfg['bot_name']}: {what} failed.\nWhy: {cls['label']}: {secret}.\nFix: add or correct it here: {where}\nNo code change.", btn)
        return {"action": "config", "class": cls, "secret": secret}

    # ---- code (or unknown)
    sigrec = state.data["signatures"].setdefault(sig, {"attempts": 0})
    if sigrec.get("attempts", 0) >= cfg["max_attempts"]:
        if not sigrec.get("gave_up"):
            sigrec.update(gave_up=True, updated=time.time())
            state.save()
            notify(io, cfg, f"🧩 {cfg['bot_name']}: {what} keeps failing with the same error after {cfg['max_attempts']} fix tries, "
                            f"so I stopped. It needs you.\nError: {cls['line'][:200]}\nLog: {link}")
        return {"action": "attempt-cap", "class": cls}
    if cls["kind"] == "unknown" and not files:
        notify(io, cfg, f"❓ {cfg['bot_name']}: {what} failed and I can't tell why.\nLast line: {cls['line'][:200]}\nLog: {link}")
        return {"action": "unknown", "class": cls}
    if open_fix_for(state, sig):
        return {"action": "fix-already-open", "class": cls}

    sigrec["attempts"] = sigrec.get("attempts", 0) + 1
    sigrec["updated"] = time.time()
    if not files and ctx.get("workflow_path") and os.path.exists(os.path.join(ROOT, ctx["workflow_path"])):
        files = [(ctx["workflow_path"], [])]
    files_txt = "\n\n".join(excerpt(ROOT, rel, lines) for rel, lines in files) or "(no repo files in the traceback)"
    _, diff_txt = git(io, "log", "-n", "3", "--stat", "-p", "--no-color", "--", ".", ":(exclude)media", ":(exclude)state", ":(exclude)library.json", ":(exclude)proxy-src/.mirror")
    baseline = run_tests(io, ROOT, discover_tests(ROOT)) if ctx["target"] != "llm-proxy" else {}
    prefix = cfg["proxy_src"].rstrip("/") + "/" if ctx["target"] == "llm-proxy" else ""

    plan, why, extra = None, "", ""
    for _round in range(2):
        try:
            ans = ask_fix(io, ctx, cls, files_txt, diff_txt, extra)
        except Exception as e:
            why = str(e)
            break
        try:
            new, old, changed = plan_edits(ans.get("edits"), ROOT, cfg, prefix)
        except ValueError as e:
            why = str(e)
            if why.startswith("protected file: .github/"):
                why = "the fix would be in a workflow file, which I am not allowed to push; " + why
            if not ans.get("edits"):
                break
            extra = f"\nYOUR LAST ANSWER WAS REJECTED: {why}. Try again, smaller and exact."
            continue
        ok, report = apply_and_check(io, ROOT, new, old, baseline)
        if ok:
            plan = (ans, new, old, changed, report)
            break
        why = "checks failed: " + report[:600]
        extra = f"\nYOUR LAST FIX FAILED THE CHECKS:\n{report[:1500]}\nFix that, smaller."
    if not plan:
        state.save()
        notify(io, cfg, f"🧩 {cfg['bot_name']}: {what} failed.\nWhat broke: {cls['line'][:200]}\nKind: code bug\n"
                        f"I couldn't make a safe fix ({why[:200]}). Attempt {sigrec['attempts']}/{cfg['max_attempts']}. Log: {link}")
        return {"action": "no-fix", "class": cls, "why": why}

    ans, new, old, changed, report = plan
    summary = re.sub(r"\s+", " ", str(ans.get("summary") or "minimal fix")).strip()[:90]
    cause = re.sub(r"\s+", " ", str(ans.get("cause") or cls["line"])).strip()[:160]
    fix_id = re.sub(r"[^0-9a-z]", "", ctx["run_id"].lower())[:20]
    branch = f"fix/{fix_id}"
    git(io, "config", "user.name", "github-actions[bot]")
    git(io, "config", "user.email", "41898299+github-actions[bot]@users.noreply.github.com")
    steps = [git(io, "checkout", "-B", branch), git(io, "add", "--", *new.keys()),
             git(io, "commit", "-m", f"fixer: {summary}", "-m", f"Run {ctx['run_id']}: {cls['line'][:200]}"),
             git(io, "push", "-f", "origin", branch)]
    if any(c != 0 for c, _ in steps):
        state.save()
        notify(io, cfg, f"⚠️ {cfg['bot_name']}: I had a fix but could not push it: " + " | ".join(o[-150:] for c, o in steps if c != 0))
        return {"action": "push-failed", "class": cls}
    body = (f"Automatic fix for {link or ctx['workflow']}\n\n**What broke:** `{cls['line'][:300]}`\n**Cause:** {cause}\n**Fix:** {summary}\n"
            f"**Checks:** {report}\n**Lines changed:** {changed}\n\n```diff\n{unified(old, new)[:6000]}\n```\n"
            f"Signature `{sig}`, attempt {sigrec['attempts']}/{cfg['max_attempts']}.")
    code, pr = io.gh("POST", "/pulls", {"title": f"fixer: {summary}", "head": branch, "base": ctx["base_branch"], "body": body})
    if code != 201:
        state.save()
        notify(io, cfg, f"⚠️ {cfg['bot_name']}: fix is on branch {branch} but I could not open a PR (GitHub {code}). "
                        f"Turn on Settings → Actions → General → 'Allow GitHub Actions to create and approve pull requests'.")
        return {"action": "pr-failed", "class": cls, "status": code}
    fix = {"repo": io.repo, "pr": pr["number"], "branch": branch, "run_id": ctx["run_id"], "workflow": ctx["workflow"],
           "workflow_path": ctx.get("workflow_path", ""), "trigger": ctx.get("trigger"), "signature": sig, "summary": summary,
           "cause": cause, "status": "proposed", "target": ctx["target"], "chat_id": os.environ.get("FIXER_CHAT_ID", ""),
           "base_branch": ctx["base_branch"], "created": time.time(), "updated": time.time(), "files": list(new)}
    state.data["fixes"][fix_id] = fix
    sigrec["last_pr"] = pr["number"]
    files_short = ", ".join(sorted(new))
    head = (f"🛠 {cfg['bot_name']}: {what} failed.\nWhat broke: {cause}\nKind: code bug\nFix: {summary} ({changed} lines in {files_short}; {report[:120]})")
    if cfg.get("FIXER_AUTO_MERGE"):
        sha, mcode = merge_pr(io, pr["number"], f"fixer: {summary} (#{pr['number']})")
        if sha:
            fix.update(status="merged", merged_sha=sha, merged_at=iso_now(), updated=time.time(), auto=True)
            io.gh("DELETE", f"/git/refs/heads/{branch}")
            again = redispatch(io, fix["trigger"], ctx) if ctx["target"] != "llm-proxy" else "deploy it with: bash ~/fixer/pull-proxy.sh"
            state.save()
            notify(io, cfg, head + f"\nAuto-merged PR #{pr['number']} (FIXER_AUTO_MERGE is on); {again}.")
            return {"action": "auto-merged", "class": cls, "pr": pr["number"]}
        head += f"\n(auto-merge failed: GitHub {mcode})"
    k = cfg["repo_key"]
    mid = notify(io, cfg, head + f"\nPR #{pr['number']}. Approve to merge and re-run.", [
        [{"text": "✅ Approve", "callback_data": f"fx:a:{k}:{fix_id}"}, {"text": "❌ Reject", "callback_data": f"fx:x:{k}:{fix_id}"}],
        [{"text": "🔎 View the change", "url": pr.get("html_url") or f"https://github.com/{io.repo}/pull/{pr['number']}"}]])
    fix["message_id"] = mid
    state.save()
    return {"action": "proposed", "class": cls, "pr": pr["number"], "fix_id": fix_id}


def open_fix_for(state, sig):
    return any(f.get("signature") == sig and f.get("status") == "proposed" for f in state.data["fixes"].values())


def iso_now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def main(argv):
    if len(argv) > 2 and argv[1] == "classify":
        text, _ = clean_log(open(argv[2], errors="replace").read())
        print(json.dumps(classify(text), indent=1))
        return 0
    event_name = os.environ.get("GITHUB_EVENT_NAME", "")
    event = json.load(open(os.environ["GITHUB_EVENT_PATH"])) if os.environ.get("GITHUB_EVENT_PATH") else {}
    res = handle(IO(), event_name, event)
    print(json.dumps(res, default=str)[:2000])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
