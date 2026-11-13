import assert from "node:assert/strict";
import { test } from "node:test";
import { decideRun, estimateRun, slugFromPremise } from "../src/pipeline/run.js";
import { structureFor } from "../src/pipeline/budget.js";
import { loadForms } from "../src/voice/load.js";
import type { Project, SceneState } from "../src/store/project.js";

function project(over: Partial<Project["meta"]> = {}, scenes: Record<string, SceneState> = {}): Project {
  const meta = {
    slug: "rooftop",
    title: "Rooftop",
    premise: "A man witnesses his pet dog jump off the roof.",
    voiceKey: "house",
    form: "flash",
    words: 900,
    pov: "third-limited",
    tense: "past",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
  return {
    meta,
    plan: null,
    scenes,
    anchors: [],
    bible: { entities: [], facts: [], threads: [], events: [], knowledge: [] },
  };
}

function scene(words: number): SceneState {
  return {
    id: "ch01-s01",
    chapter: 1,
    beat: "a beat",
    targetWords: 900,
    words,
    status: words > 0 ? "drafted" : "pending",
    passes: 0,
  };
}

test("slugFromPremise drops stop words and caps at six", () => {
  assert.equal(
    slugFromPremise("A man witnesses his pet dog jump off the roof of his 20 story apartment building."),
    "man-witnesses-pet-dog-jump-roof",
  );
  assert.equal(slugFromPremise("!!!"), "story");
  assert.equal(slugFromPremise("The"), "story");
});

test("slugFromPremise is stable and filesystem-safe", () => {
  const slug = slugFromPremise("A woman inherits her dead sister's apartment");
  assert.ok(/^[a-z0-9-]+$/.test(slug));
  assert.ok(!slug.startsWith("-") && !slug.endsWith("-"));
});

test("estimateRun counts scenes from the real allocator", () => {
  const form = loadForms().find((f) => f.id === "short")!;
  const est = estimateRun(3000, form);
  assert.equal(est.scenes, structureFor(3000, form).totalScenes);
  assert.ok(est.costUsd > 0.02);
});

test("decideRun creates when there is no project", () => {
  const d = decideRun({ existing: null, premise: "x", words: 900 });
  assert.equal(d.action, "create");
});

test("decideRun resumes when premise and words match", () => {
  const d = decideRun({ existing: project(), premise: "A man witnesses his pet dog jump off the roof.", words: 900 });
  assert.equal(d.action, "resume");
  assert.equal(d.replan, false);
});

test("decideRun normalises whitespace and case when comparing premises", () => {
  const d = decideRun({
    existing: project(),
    premise: "  a MAN witnesses   his pet dog jump off the roof. ",
    words: 900,
  });
  assert.equal(d.action, "resume");
});

test("decideRun refuses a different story in the same directory", () => {
  const d = decideRun({ existing: project(), premise: "A woman inherits an apartment.", words: 900 });
  assert.equal(d.action, "refuse");
  assert.match(d.reason ?? "", /different story/);
});

test("decideRun re-plans a word count change when nothing is drafted", () => {
  const d = decideRun({ existing: project({}, { "ch01-s01": scene(0) }), premise: project().meta.premise, words: 2000 });
  assert.equal(d.action, "resume");
  assert.equal(d.replan, true);
});

test("decideRun refuses a word count change after drafting", () => {
  const d = decideRun({
    existing: project({}, { "ch01-s01": scene(900) }),
    premise: project().meta.premise,
    words: 2000,
  });
  assert.equal(d.action, "refuse");
  assert.match(d.reason ?? "", /word count changed/i);
});

test("decideRun force always creates", () => {
  const d = decideRun({ existing: project({}, { "ch01-s01": scene(900) }), premise: "anything", words: 1, force: true });
  assert.equal(d.action, "create");
});
