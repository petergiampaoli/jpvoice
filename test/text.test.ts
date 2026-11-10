import assert from "node:assert/strict";
import { test } from "node:test";
import { countWords, extractDialogue, splitParagraphs, splitSentences } from "../src/util/text.js";

test("countWords ignores standalone punctuation and markdown", () => {
  assert.equal(countWords("The room was cold."), 4);
  assert.equal(countWords("She paused — then left."), 4);
  assert.equal(countWords("**Bold** and *italic*."), 3);
  assert.equal(countWords("  "), 0);
});

test("splitSentences splits on terminal punctuation", () => {
  const s = splitSentences("The room was cold. She put the bag down. He said nothing.");
  assert.equal(s.length, 3);
});

test("splitSentences keeps abbreviations intact", () => {
  const s = splitSentences("Mr. Ono came at three. He did not knock.");
  assert.equal(s.length, 2);
  assert.ok(s[0]!.startsWith("Mr. Ono"));
});

test("splitSentences handles dialogue with internal full stops", () => {
  const s = splitSentences('"I see." He looked away. "Then I will go."');
  assert.equal(s.length, 3);
  assert.ok(s[0]!.includes("I see"));
  assert.ok(s[2]!.startsWith('"Then'));
});

test("splitSentences does not split decimals or initials", () => {
  const s = splitSentences("It cost 3.50 yen. J. Smith paid.");
  assert.equal(s.length, 2);
});

test("extractDialogue returns quoted spans", () => {
  const d = extractDialogue('She said, "I am sorry." He said nothing. "Is that so?"');
  assert.equal(d.length, 2);
  assert.equal(d[0], "I am sorry.");
});

test("splitParagraphs drops blank runs", () => {
  const p = splitParagraphs("One.\n\n\nTwo.\n\nThree.");
  assert.deepEqual(p, ["One.", "Two.", "Three."]);
});

test("countWords matches writer counting for hyphenates", () => {
  assert.equal(countWords("a well-known man"), 3);
});
