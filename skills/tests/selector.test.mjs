import test from "node:test";
import assert from "node:assert/strict";
import { selectSkills } from "../runtime/selector.mjs";

test("selects short-form skills for a vertical short", async () => {
  const result = await selectSkills({
    brief: "Create a 30 second TikTok short with a strong hook and fast pacing",
    format: "vertical", genre: "social"
  });
  const ids = result.skills.map(s => s.id);
  assert.ok(ids.includes("shortform.retention"));
  assert.ok(ids.includes("storytelling.core"));
});

test("selects documentary research for factual documentary brief", async () => {
  const result = await selectSkills({
    brief: "A documentary about history and research with verified facts",
    format: "landscape", genre: "documentary"
  });
  assert.ok(result.skills.some(s => s.id === "documentary.research"));
});

test("returns reasons and quality checks", async () => {
  const result = await selectSkills({brief:"animated chart infographic", format:"square", genre:"education"});
  const motion = result.skills.find(s => s.id === "motion.graphics");
  assert.ok(motion);
  assert.ok(motion.reasons.length);
  assert.ok(motion.qualityChecks.includes("label-legibility"));
});

test("caps selected skills", async () => {
  const result = await selectSkills({
    brief:"documentary tiktok short motion graphics animated text sound music cinematic b-roll",
    format:"vertical", genre:"documentary"
  }, {maxSkills:3});
  assert.ok(result.skills.length <= 3);
});
