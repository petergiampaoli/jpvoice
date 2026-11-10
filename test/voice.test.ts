import assert from "node:assert/strict";
import { test } from "node:test";
import { allocate, reconcilePlan, structureFor, totalPlannedWords } from "../src/pipeline/budget.js";
import type { StoryPlan } from "../src/pipeline/budget.js";
import { composeVoice, formForWords } from "../src/voice/compose.js";
import { loadForms } from "../src/voice/load.js";

test("allocate sums exactly to the target", () => {
  for (const total of [1200, 3000, 15000, 30000, 40000]) {
    const count = Math.max(1, Math.min(60, Math.round(total / 1200)));
    const budgets = allocate(total, count, 800, 1600);
    assert.equal(budgets.reduce((a, b) => a + b, 0), total);
    if (total / count >= 800 && total / count <= 1600) {
      assert.ok(budgets.every((b) => b >= 800 && b <= 1600));
    }
  }
});

test("allocate handles a total below the minimum gracefully", () => {
  const budgets = allocate(500, 1, 800, 1600);
  assert.equal(budgets.length, 1);
  assert.equal(budgets[0], 500);
});

test("structureFor a novella scales by scenes, not by lengthening them", () => {
  const novella = loadForms().find((f) => f.id === "novella")!;
  const s = structureFor(30000, novella);
  assert.equal(s.totalWords, 30000);
  assert.equal(s.sceneBudgets.reduce((a, b) => a + b, 0), 30000);
  assert.ok(s.sceneBudgets.every((b) => b <= 1600), "no scene may exceed the cap");
  assert.ok(s.totalScenes >= 15, `expected many scenes, got ${s.totalScenes}`);
});

test("structureFor a flash piece is a single scene", () => {
  const flash = loadForms().find((f) => f.id === "flash")!;
  const s = structureFor(900, flash);
  assert.equal(s.totalScenes, 1);
  assert.equal(s.chapters.length, 1);
});

test("reconcilePlan forces an oversized plan onto the structure", () => {
  const novella = loadForms().find((f) => f.id === "novella")!;
  const structure = structureFor(30000, novella);
  const raw: StoryPlan = {
    title: "X",
    logline: "",
    characters: [],
    chapters: Array.from({ length: 40 }, (_, i) => ({
      number: i + 1,
      title: `Chapter ${i + 1}`,
      function: "accumulation",
      targetWords: 5000,
      scenes: Array.from({ length: 5 }, (_, j) => ({
        id: `${i}-${j}`,
        beat: "a beat",
        targetWords: 5000,
      })),
    })),
  };
  const plan = reconcilePlan(raw, structure, "X");
  assert.equal(plan.chapters.length, structure.chapters.length);
  assert.equal(totalPlannedWords(plan), 30000);
});

test("formForWords maps counts to forms", () => {
  assert.equal(formForWords(800), "flash");
  assert.equal(formForWords(4000), "short");
  assert.equal(formForWords(30000), "novella");
  assert.equal(formForWords(80000), "novel");
});

test("canonical pairings are marked canonical", () => {
  const v = composeVoice({ key: "kawabata/seidensticker", form: "short" });
  assert.equal(v.status, "canonical");
});

test("unlisted pairings are labelled synthetic", () => {
  const v = composeVoice({ key: "murakami/keene", form: "short" });
  assert.equal(v.status, "synthetic");
});

test("short forms widen the short-sentence band", () => {
  const flash = composeVoice({ key: "kawabata/seidensticker", form: "flash" });
  const novella = composeVoice({ key: "kawabata/seidensticker", form: "novella" });
  const f = flash.targets.shortSentenceRatio!;
  const n = novella.targets.shortSentenceRatio!;
  assert.ok(f[0] > n[0], "flash should demand more short sentences than novella");
});

test("composed voice merges author and translator lexicon", () => {
  const v = composeVoice({ key: "kawabata/seidensticker", form: "short" });
  assert.ok(v.lexicon.prefer.includes("white"));
  assert.ok(v.lexicon.prefer.includes("for a while"));
  assert.ok(v.lexicon.banned.includes("a wave of"));
});

test("first-person authors set the POV", () => {
  const v = composeVoice({ key: "dazai/keene", form: "short" });
  assert.equal(v.pov, "first");
});
