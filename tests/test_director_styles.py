import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import director_styles as ds


class T(unittest.TestCase):
    def tl(self, i, recipe="documentary"):
        return {"id": "proj-%d" % i, "style": {"recipe": recipe}}

    def test_default_matches_old_behaviour(self):
        d = ds.DEFAULT
        self.assertEqual((d["gap_mul"], d["callout_mul"], d["icon_mul"], d["hook"], d["wash"], d["callout"]), (1.0, 1.0, 1.0, "behind", 0.35, "mixed"))

    def test_deterministic_and_seed_changes_plan(self):
        a = ds.pick(self.tl(1)); b = ds.pick(self.tl(1))
        self.assertEqual(a, b)
        names = {ds.pick(self.tl(1), {"variation_seed": s})["name"] for s in range(30)}
        self.assertGreaterEqual(len(names), 3)

    def test_variety_across_projects_documentary(self):
        c = {}
        for i in range(400):
            n = ds.pick(self.tl(i))["name"]; c[n] = c.get(n, 0) + 1
        self.assertGreaterEqual(len(c), 5)
        self.assertLess(max(c.values()) / 400, 0.4)
        self.assertNotIn("kinetic", c)             # not allowed for documentary

    def test_news_style_never_restrained(self):
        for i in range(200):
            self.assertIn(ds.pick(self.tl(i, "kinetic-news"))["name"], ("kinetic", "data-forward", "classic", "editorial"))

    def test_recent_styles_are_avoided(self):
        for i in range(200):
            n = ds.pick(self.tl(i), {"recent_styles": ["classic", "restrained"]})["name"]
            self.assertNotIn(n, ("classic", "restrained"))

    def test_all_excluded_still_returns_something(self):
        r = ds.pick(self.tl(1, "cinematic"), {"recent_styles": ["restrained", "cold-open"]})
        self.assertIn(r["name"], ds.STYLES)
        r = ds.pick(self.tl(1, "kinetic-news"), {"recent_styles": ["kinetic", "data-forward"]})
        self.assertIn(r["name"], ds.STYLES)

    def test_forced_style_and_valid_knobs(self):
        self.assertEqual(ds.pick(self.tl(1), {"director_style": "Editorial"})["name"], "editorial")
        for n, s in ds.STYLES.items():
            self.assertIn(s["hook"], ("behind", "top", "quiet")); self.assertIn(s["callout"], ("mixed", "corner", "underline", "plain"))
            self.assertTrue(0.4 <= s["gap_mul"] <= 2 and 0.3 <= s["callout_mul"] <= 2.5 and 0 <= s["wash"] <= 0.6)

    def test_unknown_recipe_works(self):
        self.assertIn(ds.pick({"id": "x"})["name"], ds.STYLES)
        self.assertIn(ds.pick({})["name"], ds.STYLES)


class Spoken(unittest.TestCase):
    def test_years(self):
        f = ds.spoken_fact
        self.assertEqual(f("A nineteen eighty-five Sony Walkman"), "1985")
        self.assertEqual(f("in eighteen sixty-three the law changed"), "1863")
        self.assertEqual(f("back in nineteen oh seven"), "1907")
        self.assertEqual(f("around nineteen hundred"), "1900")
        self.assertEqual(f("by twenty twenty-four"), "2024")
        self.assertEqual(f("In Twenty Twenty we waited"), "2020")
        self.assertEqual(f("sixteen fifteen was a year"), "1615")

    def test_non_years(self):
        for s in ("nineteen people came", "twenty things", "she bought nineteen", "ninety nine problems", ""):
            self.assertEqual(ds.spoken_fact(s), "", s)

    def test_classic_is_off_others_on(self):
        self.assertFalse(ds.STYLES["classic"]["spoken"]); self.assertFalse(ds.DEFAULT["spoken"])
        self.assertTrue(all(v["spoken"] for k, v in ds.STYLES.items() if k != "classic"))


class Camera(unittest.TestCase):
    def tl(self, i, recipe="documentary"):
        return {"id": "proj-%d" % i, "style": {"recipe": recipe}}

    def test_classic_equals_old_constants(self):
        c = ds.pick_camera(self.tl(1), {"camera_style": "classic"})
        self.assertEqual((c["orbit_every"], c["orbit_phase"], c["truck_every"], c["truck_phase"], c["base"], c["amp_mul"], c["whips"], c["pt_mod"], c["last"]),
                         (3, 0, 4, 2, ["drift"], 1.0, 2, 2, "pull-out"))

    def test_deterministic_and_varied(self):
        self.assertEqual(ds.pick_camera(self.tl(5)), ds.pick_camera(self.tl(5)))
        names = {ds.pick_camera(self.tl(i))["name"] for i in range(300)}
        self.assertGreaterEqual(len(names), 4)
        self.assertNotIn("restless", names)         # not for documentary

    def test_news_never_steady_and_recent_avoided(self):
        for i in range(150):
            self.assertNotIn(ds.pick_camera(self.tl(i, "kinetic-news"))["name"], ("steady", "observational"))
            self.assertNotIn(ds.pick_camera(self.tl(i), {"recent_camera": ["classic", "steady"]})["name"], ("classic", "steady"))

    def test_moves_are_known_and_phases_in_range(self):
        ok = {"hold", "push-in", "pull-out", "orbit", "truck", "drift"}
        for i in range(200):
            c = ds.pick_camera(self.tl(i))
            self.assertTrue(set(c["base"]) <= ok and c["last"] in ok)
            self.assertTrue(0 <= c["orbit_phase"] < c["orbit_every"] and 0 <= c["truck_phase"] < c["truck_every"])
            self.assertTrue(0 <= c["whips"] <= 3 and 1 <= c["pt_mod"] <= 3)


if __name__ == "__main__":
    unittest.main()
