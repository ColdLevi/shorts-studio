#!/usr/bin/env python3
"""install_boardfx.py: boards as an OVERLAY over real footage (no host).
Run from ~/shorts-studio on branch `boards` (needs Board.tsx from install_board.py).
1. overlay kind 'board' (Overlays.tsx, types.ts, timeline.schema.json), all-or-nothing, backups *.pre-boardfx
2. writes tools/make_boards_patch.py (project timeline -> JSON patch with a board on every scene)
3. writes ~/storage/downloads/arb-spec-stock.json (the arbitrage spec with real stock footage per scene, no Pip)"""
import glob, json, os, shutil, sys

R = "remotion/src/studio/"
files = {"o": R + "Overlays.tsx", "t": R + "types.ts", "s": "timeline/timeline.schema.json"}
txt = {k: open(v).read() for k, v in files.items()}
problems = []
if not os.path.exists("remotion/src/packs/whatif/Board.tsx"): problems.append("Board.tsx missing: run install_board.py first")
if "BoardOverlay" in txt["o"]: problems.append("already patched")

def once(k, old, new):
    c = txt[k].count(old)
    if c != 1: problems.append("%s: anchor found %d times: %s" % (files[k], c, old[:55]))
    else: txt[k] = txt[k].replace(old, new)

BOARD_OV = '''
// board: a scripted graphic (price cards, lanes, triangle ...) over the footage, on a soft dark scrim. Timed by anchor/start/end like any overlay.
const BoardOverlay: React.FC<{ o: TextOverlay; L: Layout }> = ({ o, L }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const Board = BOARDS[o.board || ''];
  if (!Board) return null;
  const dur = Math.max(15, Math.round(Math.max(0.5, o.end - o.start) * fps));
  const op = Math.min(interpolate(frame, [0, 0.35 * fps], [0, 1], CLAMP), interpolate(frame, [dur - 0.4 * fps, dur], [1, 0], CLAMP));
  const vw = L.w / L.u, vh = L.h / L.u;
  return (
    <AbsoluteFill style={{ opacity: op }}>
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 50%, rgba(14,8,32,0.80) 0%, rgba(14,8,32,0.55) 100%)' }} />
      <svg width={L.w} height={L.h} viewBox={`${-vw / 2} ${-vh / 2} ${vw} ${vh}`} style={{ position: 'absolute', inset: 0 }}>
        <Board frame={frame} fps={fps} dur={dur} />
      </svg>
    </AbsoluteFill>
  );
};

'''
once("o", "import type { TextOverlay } from './types';", "import type { TextOverlay } from './types';\nimport { BOARDS } from '../packs/whatif/Board';")
once("o", "\ntype OvProps = React.ComponentProps<typeof OverlayBase>;", BOARD_OV + "type OvProps = React.ComponentProps<typeof OverlayBase>;")
once("o", "  if (o.kind === 'image' || o.kind === 'chapter' || (o.kind === 'text' && o.anim)) return <OverlayBase {...props} />;",
     "  if (o.kind === 'board') return <BoardOverlay o={o} L={L} />;\n  if (o.kind === 'image' || o.kind === 'chapter' || (o.kind === 'text' && o.anim)) return <OverlayBase {...props} />;")
once("t", "kind: 'title' | 'text' | 'lower-third' | 'image' | 'chapter';", "kind: 'title' | 'text' | 'lower-third' | 'image' | 'chapter' | 'board';")
once("t", "  subColor?: string;\n};", "  subColor?: string;\n  board?: string;   // kind 'board': cards book lanes triangle funding bars leg check close\n};")
# schema: parse, check the round trip is lossless, then edit
raw = txt["s"]
sch = json.loads(raw)
for ind in (2, 4):
    if json.dumps(sch, indent=ind, ensure_ascii=False) + "\n" == raw or json.dumps(sch, indent=ind, ensure_ascii=False) == raw:
        break
else:
    ind = None
    problems.append("schema formatting not reproducible; not touching it")
ov = sch["properties"]["tracks"]["properties"]["overlays"]["items"]["properties"]
if "board" in ov: problems.append("schema already has board")
if problems:
    print("NOTHING CHANGED:"); [print(" -", p) for p in problems]; sys.exit(1)
ov["kind"]["enum"].append("board")
ov["board"] = {"type": "string"}
nl = "\n" if raw.endswith("\n") else ""
txt["s"] = json.dumps(sch, indent=ind, ensure_ascii=False) + nl
for k, v in files.items():
    shutil.copy(v, v + ".pre-boardfx")
    open(v, "w").write(txt[k])
    print("patched", v)

PATCH = '''#!/usr/bin/env python3
"""make_boards_patch.py PROJECT_ID: puts one board overlay on each scene of a rendered project (anchored to the scene, so timing follows the voice).
Writes ~/patch.json. Captions go off (the boards carry the words)."""
import json, os, sys
pid = sys.argv[1]
t = json.load(open("media/projects/%s/timeline.json" % pid))
vis = sorted(t["tracks"]["visuals"], key=lambda v: v["start"])
kinds = ["cards", "book", "lanes", "triangle", "funding", "bars", "leg", "check", "close"]
if len(vis) != len(kinds):
    sys.exit("expected %d scenes, project has %d. Send me this number." % (len(kinds), len(vis)))
ops = [{"op": "add", "path": "/tracks/overlays/-",
        "value": {"id": "b%d" % (i + 1), "kind": "board", "board": k, "anchor": v["id"], "start": v["start"], "end": v["end"]}}
       for i, (k, v) in enumerate(zip(kinds, vis))]
ops.append({"op": "merge", "path": "/style/caption", "value": {"preset": "none"}})
json.dump(ops, open(os.path.expanduser("~/patch.json"), "w"))
print("wrote ~/patch.json:", len(ops), "ops, scenes", [v["id"] for v in vis])
'''
open("tools/make_boards_patch.py", "w").write(PATCH)
print("wrote tools/make_boards_patch.py")

dl = os.path.expanduser("~/storage/downloads/")
specs = [s for s in sorted(glob.glob(dl + "arb-spec*.json"), key=os.path.getmtime) if "board" not in s and "stock" not in s]
if not specs: sys.exit("no arb-spec*.json in Downloads")
d = json.load(open(specs[-1]))
Q = ["bitcoin cryptocurrency coins close up", "stock market trading screens data", "waiting clock time passing",
     "cryptocurrency chart on screen", "financial chart graph screen", "calculator money desk",
     "warning alert computer screen", "checklist notebook pen desk", "city skyline night lights"]
for b, q in zip(d["beats"], Q):
    b.pop("scene", None)
    b["tool"] = "stock"; b["query"] = q; b["image_prompt"] = q + ", cinematic, no text"
out = dl + "arb-spec-stock.json"
json.dump(d, open(out, "w"), separators=(",", ":"))
print("wrote", out, len(d["beats"]), "beats")
