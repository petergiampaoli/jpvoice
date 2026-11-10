import assert from "node:assert/strict";
import { test } from "node:test";
import { analyze, detectNames } from "../src/metrics/stylometry.js";

const IN_REGISTER = `The room was small. There was a table and a chair. The bed had been made. That was the first thing she noticed. On the table there was a cup with a chip at the rim. She looked at it for a while. In any case, it did not matter.`;

const OFF_REGISTER = `A wave of grief washed over her as she entered the room, and she felt her heart pound. It was, in that moment, as if the weight of eleven years pressed down on her chest. She couldn't help but let out a breath.`;

test("analyze produces coherent counts", () => {
  const m = analyze(IN_REGISTER);
  assert.ok(m.words > 40);
  assert.ok(m.sentences >= 6);
  assert.ok(m.shortSentenceRatio > 0.5, `expected short sentences, got ${m.shortSentenceRatio}`);
  assert.equal(m.dialogueRatio, 0);
  assert.equal(m.emDashPer1k, 0);
});

test("analyze detects register breakers", () => {
  const m = analyze(OFF_REGISTER);
  const phrases = m.breakers.map((b) => b.phrase);
  assert.ok(phrases.includes("a wave of"));
  assert.ok(phrases.includes("in that moment"));
  assert.ok(phrases.includes("the weight of"));
  assert.ok(m.similePer1k >= 1);
});

test("off-register sample has far more abstraction and hedging", () => {
  const a = analyze(IN_REGISTER);
  const b = analyze(OFF_REGISTER);
  assert.ok(b.abstractionRatio >= a.abstractionRatio);
  assert.ok(b.adverbRatio >= a.adverbRatio);
});

test("detectNames finds repeated mid-sentence proper nouns", () => {
  const names = detectNames("Ono came in. She looked at Ono. Ono said nothing.");
  assert.deepEqual(names, ["Ono"]);
});

test("detectNames ignores sentence-initial common words", () => {
  const names = detectNames("The room was cold. The window was open. The table was bare.");
  assert.equal(names.length, 0);
});

test("tic rates are per thousand words", () => {
  const text = "for a while. ".repeat(10) + "and then.";
  const m = analyze(text, { ticPhrases: ["for a while"] });
  const expected = (10 / m.words) * 1000;
  assert.ok(Math.abs((m.tics["for a while"] ?? 0) - expected) < 0.01);
});

test("dialogue ratio measures words inside quotes", () => {
  const m = analyze('"I am sorry," she said. "Is that so?" He nodded. "Yes."');
  assert.ok(m.dialogueRatio > 0.4);
});
