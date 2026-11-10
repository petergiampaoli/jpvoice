import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { composeVoice } from "../src/voice/compose.js";
import { scoreText } from "../src/pipeline/score.js";
import { detectNames, type Metrics } from "../src/metrics/stylometry.js";
import pc from "picocolors";

const voice = composeVoice({ key: "kawabata/seidensticker", form: "short" });

const files = {
  "native-English default": resolve("samples/off-register.md"),
  "translated register": resolve("samples/in-register.md"),
};

const results: Record<string, { m: Metrics; score: number }> = {};
for (const [label, path] of Object.entries(files)) {
  const text = readFileSync(path, "utf8");
  const { metrics, report } = scoreText(text, voice, detectNames(text));
  results[label] = { m: metrics, score: report.score };
}

const [off, on] = ["native-English default", "translated register"];
if (!off || !on) throw new Error("labels");
const a = results[off]!;
const b = results[on]!;

const rows: Array<[string, (m: Metrics) => string, string]> = [
  ["words", (m) => String(m.words), ""],
  ["mean sentence", (m) => String(m.meanSentenceWords), "11–17"],
  ["short (≤8w)", (m) => (m.shortSentenceRatio * 100).toFixed(0) + "%", "34–54%"],
  ["hedges /1k", (m) => String(m.hedgePer1k), "5–15"],
  ["filter verbs /1k", (m) => String(m.filterVerbPer1k), "6–18"],
  ["similes /1k", (m) => String(m.similePer1k), "0–4"],
  ["em dashes /1k", (m) => String(m.emDashPer1k), "0–1.5"],
  ["dialogue", (m) => (m.dialogueRatio * 100).toFixed(0) + "%", "14–32%"],
  ["register breakers", (m) => String(m.breakers.reduce((s, x) => s + x.count, 0)), "0"],
];

console.log("");
console.log(pc.bold("  Same story. Two registers."));
console.log(pc.dim(`  measured against ${voice.label}\n`));
console.log("  " + "metric".padEnd(20) + "native English".padEnd(18) + "translated".padEnd(14) + "target");
console.log("  " + "-".repeat(68));
for (const [label, fn, target] of rows) {
  console.log("  " + label.padEnd(20) + fn(a.m).padEnd(18) + pc.green(fn(b.m)).padEnd(20) + pc.dim(target));
}
console.log("  " + "-".repeat(68));
console.log("  " + "conformance".padEnd(20) + pc.red(a.score + "/100").padEnd(26) + pc.green(b.score + "/100"));
console.log("");

console.log(pc.bold("  Register breakers in the native-English version"));
for (const br of a.m.breakers) {
  console.log(`  ${pc.red("×" + br.count)}  ${br.phrase}  ${pc.dim("— " + br.why)}`);
}
console.log("");
