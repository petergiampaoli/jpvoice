import assert from "node:assert/strict";
import { test } from "node:test";
import { composeVoice, parseVoiceKey, parseVoiceRequest } from "../src/voice/compose.js";
import { GUEST_THRESHOLD, blendVoices } from "../src/voice/blend.js";
import { loadEnsembles } from "../src/voice/load.js";
import { renderVoiceSpec } from "../src/voice/render.js";
import { findForm } from "../src/voice/load.js";

test("the house register is the default and is labelled constructed", () => {
  const v = composeVoice({ key: "house", form: "short" });
  assert.equal(v.key, "house");
  assert.equal(v.status, "constructed");
  assert.ok(v.label.toLowerCase().includes("house"));
  assert.ok(v.targets.meanSentenceWords);
  assert.equal(v.chorus, undefined);
});

test("an empty voice spec resolves to the house register", () => {
  const v = composeVoice({ key: "", form: "short" });
  assert.equal(v.key, "house");
});

test("renderVoiceSpec marks a constructed register honestly", () => {
  const v = composeVoice({ key: "house", form: "short" });
  const text = renderVoiceSpec(v);
  assert.ok(text.includes("Pairing status: constructed"));
  assert.ok(text.includes("no historical pairing"));
  assert.ok(text.includes("House"));
});

test("a bare author resolves to its canonical translator", () => {
  assert.deepEqual(parseVoiceKey("kawabata"), {
    author: "kawabata",
    translator: "seidensticker",
  });
  const v = composeVoice({ key: "kawabata", form: "short" });
  assert.equal(v.key, "kawabata/seidensticker");
  assert.equal(v.status, "canonical");
});

test("parseVoiceRequest distinguishes single, house, blend and ensemble", () => {
  assert.deepEqual(parseVoiceRequest(""), { kind: "house" });
  assert.deepEqual(parseVoiceRequest("house"), { kind: "house" });
  assert.deepEqual(parseVoiceRequest("kawabata/seidensticker"), {
    kind: "single",
    key: "kawabata/seidensticker",
  });
  const blend = parseVoiceRequest("kawabata/seidensticker:70, abe/saunders:30");
  assert.equal(blend.kind, "blend");
  const ens = parseVoiceRequest("provincial-gothic");
  assert.equal(ens.kind, "ensemble");
});

test("blend weights normalise and the dominant voice supplies POV", () => {
  const v = composeVoice({
    key: "kawabata/seidensticker:70, dazai/keene:30",
    form: "short",
  });
  assert.equal(v.chorus?.members.length, 2);
  const weights = v.chorus!.members.map((m) => m.weight);
  assert.ok(Math.abs(weights.reduce((a, b) => a + b, 0) - 1) < 0.001);
  assert.equal(v.pov, "third-limited"); // Kawabata is third; Dazai is first
  assert.equal(v.chorus?.members[0]?.role, "dominant");
});

test("bans are unioned across a chorus", () => {
  const v = composeVoice({
    key: "kawabata/seidensticker:50, oe/bester:50",
    form: "short",
  });
  assert.ok(v.lexicon.banned.includes("a wave of"));
  assert.ok(v.lexicon.banned.some((b) => b.includes("time seemed to slow")));
});

test("a guest below the threshold does not move numeric targets", () => {
  const kawabata = composeVoice({ key: "kawabata/seidensticker", form: "short" });
  const blended = composeVoice({
    key: "kawabata/seidensticker:90, oe/bester:10",
    form: "short",
  });
  assert.ok(0.1 < GUEST_THRESHOLD);
  assert.deepEqual(blended.targets.meanSentenceWords, kawabata.targets.meanSentenceWords);
  assert.equal(blended.chorus?.members.find((m) => m.key.includes("bester"))?.role, "guest");
});

test("equal full members sit between their bands", () => {
  const a = composeVoice({ key: "kawabata/seidensticker", form: "short" });
  const b = composeVoice({ key: "murakami/rubin", form: "short" });
  const v = composeVoice({ key: "kawabata/seidensticker:50, murakami/rubin:50", form: "short" });
  const band = v.targets.meanSentenceWords!;
  const lo = Math.min(a.targets.meanSentenceWords![0], b.targets.meanSentenceWords![0]);
  const hi = Math.max(a.targets.meanSentenceWords![1], b.targets.meanSentenceWords![1]);
  assert.ok(band[0] >= lo - 0.01 && band[1] <= hi + 0.01);
});

test("tic ceilings scale with membership weight", () => {
  const k = composeVoice({ key: "kawabata/seidensticker", form: "short" });
  const m = composeVoice({ key: "murakami/rubin", form: "short" });
  const kTic = k.tics.find((t) => t.phrase === "a little")?.per1kMax ?? 0;
  const mTic = m.tics.find((t) => t.phrase === "a little")?.per1kMax ?? 0;
  const v = composeVoice({ key: "kawabata/seidensticker:50, murakami/rubin:50", form: "short" });
  const blended = v.tics.find((t) => t.phrase === "a little")?.per1kMax ?? 0;
  assert.ok(Math.abs(blended - (kTic + mTic) / 2) < 0.02);
});

test("blending is deterministic", () => {
  const spec = "kawabata/seidensticker:60, abe/saunders:30, dazai/keene:10";
  const a = composeVoice({ key: spec, form: "short" });
  const b = composeVoice({ key: spec, form: "short" });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("named ensembles load and compose", () => {
  const ensembles = loadEnsembles();
  assert.ok(ensembles.length >= 1);
  const v = composeVoice({ key: "provincial-gothic", form: "short" });
  assert.equal(v.chorus?.members.length, 3);
  assert.equal(v.status, "constructed");
  assert.ok(v.label.toLowerCase().includes("provincial"));
});

test("a blend with a single member is refused", () => {
  assert.throws(() => composeVoice({ key: "kawabata/seidensticker,", form: "short" }));
});

test("nested ensembles are refused", () => {
  assert.throws(
    () => composeVoice({ key: "provincial-gothic:50, kawabata/seidensticker:50", form: "short" }),
    /Nested ensembles/,
  );
});

test("blendVoices refuses fewer than two parts", () => {
  const v = composeVoice({ key: "kawabata/seidensticker", form: "short" });
  assert.throws(() => blendVoices([{ voice: v, weight: 1 }], { form: findForm("short") }));
});

test("guest moves appear in the rendered contract", () => {
  const v = composeVoice({ key: "kawabata/seidensticker:90, dazai/keene:10", form: "short" });
  const text = renderVoiceSpec(v);
  assert.ok(text.includes("Chorus: blend"));
  assert.ok(/Guest move from Osamu Dazai/.test(text));
});
