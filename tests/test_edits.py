#!/usr/bin/env python3
"""Step 2 tests: edit patches, diffs, per-line re-voicing and version history, against timeline/example.json.
Run from the repo root:  python3 tests/test_edits.py
No network: edge-tts and FLUX are replaced by local fakes (ffmpeg tones / PIL images). Needs ffmpeg."""
import copy, json, os, shutil, subprocess, sys, tempfile, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import timeline as TL  # noqa: E402
import project as PR  # noqa: E402
import build_short as B  # noqa: E402

EX = json.load(open(os.path.join(ROOT, "timeline", "example.json")))
HAVE_FF = shutil.which("ffmpeg") is not None


def ex():
    return copy.deepcopy(EX)


# ---------- fakes for the network tools ----------
CALLS = {"voice": [], "paint": []}


def fake_voice(text, voice_name, rate, path):
    words = text.split()
    dur = 0.32 * len(words) + 0.2
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-t", f"{dur:.2f}", "-i", "sine=f=330:r=24000",
                    "-ac", "1", "-c:a", "libmp3lame", path], check=True)
    CALLS["voice"].append(text)
    return [{"word": w, "start": round(0.1 + i * 0.32, 3), "end": round(0.1 + i * 0.32 + 0.28, 3)} for i, w in enumerate(words)], dur


def fake_paint(prompt, path, tool="flux", style="", hero=False, gemini_ok=False, seed=0):
    try:
        from PIL import Image
        Image.new("RGB", (768, 1344), (40, 90, 160)).save(path, "JPEG")
    except ImportError:  # Termux without Pillow: ffmpeg makes the test picture
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x285aa0:s=768x1344", "-frames:v", "1", path], check=True)
    CALLS["paint"].append(prompt)
    return {"pixel": False}


class PatchLogic(unittest.TestCase):
    def test_id_paths_and_validate(self):
        t = ex()
        new, changed = TL.apply_patch(t, [{"op": "replace", "path": "/tracks/visuals/@v3/gen/prompt", "value": "a rocket launch at dawn"}])
        self.assertEqual(new["tracks"]["visuals"][2]["gen"]["prompt"], "a rocket launch at dawn")
        self.assertEqual(changed, ["v3"])
        self.assertEqual(TL.validate(new), [])
        self.assertNotIn("dirty", t["tracks"]["visuals"][2], "the old timeline must not be modified")

    def test_swap_scene_plan(self):
        t = ex()
        new, _ = TL.apply_patch(t, [{"op": "replace", "path": "/tracks/visuals/@v3/gen/prompt", "value": "a rocket launch"}])
        p = TL.plan(t, new)
        self.assertEqual(p["repaint"], ["v3"])
        self.assertEqual(p["revoice"], [])
        self.assertEqual(p["diff"]["visual"], ["v3"])

    def test_narration_change_revoices_one_line(self):
        t = ex()
        new, changed = TL.apply_patch(t, [{"op": "replace", "path": "/tracks/visuals/@v4/narration", "value": "So the country quietly switched to dollars."}])
        p = TL.plan(t, new)
        self.assertIn("vo", changed)
        self.assertEqual(p["revoice"], ["v4"])
        self.assertEqual(p["repaint"], [])
        segs = new["tracks"]["voice"][0]["segments"]
        self.assertEqual([s["clip"] for s in segs], ["v1", "v2", "v3", "v4"])
        self.assertEqual(segs[0]["t0"], 0.0)
        self.assertEqual(segs[1]["t0"], t["tracks"]["visuals"][1]["start"])

    def test_cut_scene(self):
        t = ex()
        new, _ = TL.apply_patch(t, [{"op": "remove", "path": "/tracks/visuals/@v2"}])
        p = TL.plan(t, new)
        self.assertEqual(p["diff"]["removed"], ["v2"])
        self.assertEqual(p["revoice"], [], "cutting a scene re-uses every other line")
        self.assertTrue(p["retime"])
        self.assertEqual(TL.validate(new), [])

    def test_add_scene_gets_id_and_recipe(self):
        t = ex()
        new, changed = TL.apply_patch(t, [{"op": "add", "path": "/tracks/visuals/2", "value": {
            "kind": "image", "narration": "Bakeries changed prices twice a day.", "gen": {"tool": "flux", "prompt": "a chalk price board"}}}])
        v = new["tracks"]["visuals"][2]
        self.assertEqual(v["id"], "v5")
        self.assertLess(v["start"], v["end"])
        p = TL.plan(t, new)
        self.assertEqual(p["repaint"], ["v5"])
        self.assertEqual(p["revoice"], ["v5"])
        self.assertEqual(TL.validate(new), [])

    def test_duplicate_id_is_renamed(self):
        t = ex()
        new, _ = TL.apply_patch(t, [{"op": "add", "path": "/tracks/visuals/-", "value": {"id": "v1", "kind": "color", "color": "#000", "start": 0, "end": 1}}])
        ids = [v["id"] for v in new["tracks"]["visuals"]]
        self.assertEqual(len(ids), len(set(ids)))

    def test_style_only_is_render_only(self):
        t = ex()
        new, changed = TL.apply_patch(t, [{"op": "merge", "path": "/style/caption", "value": {"size": 120, "color": "#FFD43B", "highlight": "#FFD43B"}}])
        p = TL.plan(t, new)
        self.assertEqual(changed, [])
        self.assertEqual((p["revoice"], p["repaint"]), ([], []))
        self.assertEqual(p["diff"]["style"], ["caption"])

    def test_reformat(self):
        t = ex()
        new, changed = TL.apply_patch(t, [{"op": "replace", "path": "/canvas", "value": {"width": 1920, "height": 1080, "fps": 30}}])
        self.assertEqual(changed, [])
        self.assertEqual(new["meta"]["format"], "landscape")
        self.assertEqual(TL.plan(t, new)["diff"]["canvas"], "1920x1080")

    def test_change_music(self):
        t = ex()
        new, _ = TL.apply_patch(t, [{"op": "replace", "path": "/tracks/music/@m1/gen/name", "value": "tech-pulse"}])
        self.assertEqual(new["tracks"]["music"][0]["src"], "library/music/clips/tech-pulse.mp3")
        self.assertTrue(TL.plan(t, new)["diff"]["music"])

    def test_slower_pacing_revoices_all(self):
        t = ex()
        new, changed = TL.apply_patch(t, [{"op": "replace", "path": "/tracks/voice/@vo/gen/rate", "value": "-12%"}])
        self.assertIn("vo", changed)
        self.assertEqual(TL.plan(t, new)["revoice"], ["v1", "v2", "v3", "v4"])

    def test_reorder_reuses_lines(self):
        t = ex()
        new, _ = TL.apply_patch(t, [{"op": "move", "from": "/tracks/visuals/@v4", "path": "/tracks/visuals/1"}])
        p = TL.plan(t, new)
        self.assertTrue(p["diff"]["reordered"])
        self.assertEqual(p["revoice"], [])

    def test_bad_patch_rejected(self):
        t = ex()
        new, _ = TL.apply_patch(t, [{"op": "replace", "path": "/tracks/visuals/@v1/kind", "value": "hologram"}])
        self.assertTrue(TL.validate(new))
        with self.assertRaises(KeyError):
            TL.apply_patch(t, [{"op": "replace", "path": "/tracks/visuals/@v9/narration", "value": "x"}])

    def test_versions_collapse_builds(self):
        log = [{"rev": 1, "message": "first build"}, {"rev": 2, "message": "test edit", "patch": [1]},
               {"rev": 3, "message": "rebuilt vo, v3"}, {"rev": 4, "message": "bigger captions", "edit_id": "e1"}]
        v = TL.versions(log)
        self.assertEqual([x["rev"] for x in v], [1, 3, 4])
        self.assertEqual(v[1]["message"], "test edit")

    def test_scenes(self):
        sc = TL.scenes(ex())
        self.assertEqual([s["n"] for s in sc], [1, 2, 3, 4])
        self.assertEqual(sc[1]["kind"], "graphic")


@unittest.skipUnless(HAVE_FF, "needs ffmpeg")
class Rebuild(unittest.TestCase):
    """End to end on a throwaway project made from example.json: queued edits -> versions -> only changed assets."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="ss-test-")
        self.old_media, self.old_root = TL.MEDIA, PR.ROOT
        TL.MEDIA = os.path.join(self.tmp, "media")
        PR.ROOT = self.tmp
        self.v, self.p = B.voice, B.paint
        B.voice, B.paint = fake_voice, fake_paint
        CALLS["voice"].clear(); CALLS["paint"].clear()
        t = ex()
        self.pid = t["id"]
        a = os.path.join(TL.project_dir(self.pid), "assets")
        os.makedirs(a)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-t", "12.3", "-i", "sine=f=220:r=24000", "-ac", "1",
                        os.path.join(a, "voice_r3.mp3")], check=True)
        for n in ("img_01.jpg", "v3_r3.jpg", "img_04.jpg"):
            fake_paint("", os.path.join(a, n))
        CALLS["paint"].clear()
        t["rev"] = 0
        TL.save(t, "first build")

    def tearDown(self):
        TL.MEDIA, PR.ROOT = self.old_media, self.old_root
        B.voice, B.paint = self.v, self.p
        shutil.rmtree(self.tmp, ignore_errors=True)

    def edits(self, items):
        f = os.path.join(self.tmp, "edits.json")
        json.dump(items, open(f, "w"))
        PR.cmd_edits(self.pid, f)
        return json.load(open(os.path.join(self.tmp, "job", "edit_report.json")))

    def check_timing(self, t):
        vis = t["tracks"]["visuals"]
        self.assertEqual(vis[0]["start"], 0.0)
        for a, b in zip(vis, vis[1:]):
            self.assertAlmostEqual(a["end"], b["start"], places=3)
        words = t["tracks"]["captions"]["words"]
        self.assertTrue(all(w2["start"] >= w1["start"] for w1, w2 in zip(words, words[1:])), "caption words in order")
        voice = TL.asset_path(self.pid, t["tracks"]["voice"][0]["src"])
        self.assertTrue(os.path.exists(voice))
        d = B.duration(voice)
        self.assertAlmostEqual(d, vis[-1]["end"], delta=0.12)
        self.assertEqual(t["duration"], round(vis[-1]["end"] + 0.8, 2))

    def test_edit_chain_undo_and_skip(self):
        # 1) change one line: only that line is recorded, nothing repainted
        r = self.edits([{"id": "e1", "message": "rewrite the ending", "patch": [
            {"op": "replace", "path": "/tracks/visuals/@v4/narration", "value": "So the country switched to dollars."}]}])
        self.assertEqual(CALLS["voice"], ["So the country switched to dollars."])
        self.assertEqual(CALLS["paint"], [])
        self.assertEqual(r["edits"][0]["revoiced"], ["v4"])
        t = TL.load(self.pid)
        self.assertEqual(t["rev"], 2)
        self.check_timing(t)
        segs = t["tracks"]["voice"][0]["segments"]
        self.assertTrue(all(s.get("src") for s in segs), "every line kept as its own file")
        sfx = t["tracks"]["sfx"][0]
        self.assertAlmostEqual(sfx["at"], t["tracks"]["visuals"][3]["start"] + 0.1, places=3)
        # first three lines keep their original length (cut from the old file)
        o = EX["tracks"]["visuals"]
        self.assertAlmostEqual(t["tracks"]["visuals"][1]["start"], o[1]["start"], delta=0.03)
        self.assertAlmostEqual(t["tracks"]["visuals"][2]["start"], o[2]["start"], delta=0.03)

        # 2) swap scene 3 + cut scene 2, queued with e1 again (already applied -> skipped)
        CALLS["voice"].clear()
        r = self.edits([{"id": "e1", "patch": []}, {"id": "e2", "message": "swap scene 3 for a rocket launch, cut scene 2", "patch": [
            {"op": "replace", "path": "/tracks/visuals/@v3/gen/prompt", "value": "a rocket launch at dawn"},
            {"op": "remove", "path": "/tracks/visuals/@v2"}]}])
        self.assertEqual(len(r["edits"]), 1)
        self.assertEqual(CALLS["voice"], [], "cut + swap re-uses every recorded line")
        self.assertEqual(CALLS["paint"], ["a rocket launch at dawn"])
        t = TL.load(self.pid)
        self.assertEqual([v["id"] for v in t["tracks"]["visuals"]], ["v1", "v3", "v4"])
        self.check_timing(t)

        # 3) style only: no assets touched
        CALLS["paint"].clear()
        r = self.edits([{"id": "e3", "message": "bigger yellow captions", "patch": [
            {"op": "merge", "path": "/style/caption", "value": {"size": 130, "color": "#FFD43B"}}]}])
        self.assertEqual((CALLS["voice"], CALLS["paint"]), ([], []))
        self.assertEqual(r["edits"][0]["revoiced"], [])

        # 4) undo back to v3 (before the captions), then restore v1
        r = self.edits([{"id": "e4", "message": "undo", "revert": 3}])
        t = TL.load(self.pid)
        self.assertNotIn("size", t["style"]["caption"])
        self.assertEqual(t["rev"], 5)
        self.edits([{"id": "e5", "message": "restore v1", "revert": 1}])
        t = TL.load(self.pid)
        self.assertEqual(len(t["tracks"]["visuals"]), 4)
        self.assertEqual((CALLS["voice"], CALLS["paint"]), ([], []), "restoring an old version re-uses its saved assets")
        v = TL.versions(TL.history(self.pid))
        self.assertEqual([x["rev"] for x in v], [1, 2, 3, 4, 5, 6])
        self.assertEqual(TL.applied_edits(self.pid), {"e1", "e2", "e3", "e4", "e5"})

    def test_rejected_edit_keeps_project(self):
        r = self.edits([{"id": "bad", "message": "nonsense", "patch": [{"op": "replace", "path": "/tracks/visuals/@v1/kind", "value": "hologram"}]}])
        self.assertIn("error", r["edits"][0])
        self.assertEqual(TL.load(self.pid)["rev"], 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
