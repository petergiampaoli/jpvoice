import assert from "node:assert/strict";
import { test } from "node:test";
import { analyze } from "../src/metrics/stylometry.js";
import { checkConformance, critiquePrompt } from "../src/critic/conformance.js";
import { composeVoice } from "../src/voice/compose.js";

const voice = composeVoice({ key: "kawabata/seidensticker", form: "short" });

test("clean in-register prose passes most rate checks at length", () => {
  const text = [
    "The room was small. There was a table and a chair.",
    "The bed had been made. That was the first thing she noticed.",
    "On the table there was a cup with a chip at the rim.",
    "She looked at it for a while. In any case, it did not matter.",
    "He asked whether she had eaten. She said that she had, on the train.",
    "The kettle made a sound. He got up and turned off the gas.",
  ].join("\n\n");
  const m = analyze(text, { ticPhrases: ["for a while"] });
  const r = checkConformance(m, voice.targets, voice);
  assert.ok(r.score > 50, `expected a respectable score, got ${r.score}`);
  assert.equal(r.issues.filter((i) => i.metric === "breaker").length, 0);
});

test("register breakers are reported as high severity", () => {
  const text = "A wave of grief washed over her. She couldn't help but let out a breath.";
  const m = analyze(text);
  const r = checkConformance(m, voice.targets, voice);
  const breakers = r.issues.filter((i) => i.metric === "breaker");
  assert.ok(breakers.length >= 2);
  assert.ok(breakers.every((b) => b.severity === "high"));
  assert.ok(r.pass === false);
});

test("an overused tic is reported with an absolute allowance", () => {
  const text = "For a while she waited. For a while she looked at the door. For a while nothing happened.";
  const m = analyze(text, { ticPhrases: ["for a while"] });
  const r = checkConformance(m, voice.targets, voice);
  const tic = r.issues.find((i) => i.metric === "tic" && i.label.includes("for a while"));
  assert.ok(tic, "expected a tic issue");
  assert.ok(String(tic!.fix).includes("allowance"));
});

test("critiquePrompt names the fixes and forbids rewriting events", () => {
  const text = "A wave of grief washed over her. Her heart pounded.";
  const m = analyze(text);
  const r = checkConformance(m, voice.targets, voice);
  const prompt = critiquePrompt(r);
  assert.ok(prompt.includes("CONFORMANCE REPORT"));
  assert.ok(prompt.includes("a wave of"));
  assert.ok(prompt.includes("Preserve every event"));
});

test("short passages do not produce spurious high severity", () => {
  const text = "The room was cold — she left.";
  const m = analyze(text);
  const r = checkConformance(m, voice.targets, voice);
  assert.ok(r.issues.every((i) => i.severity !== "high"));
});
