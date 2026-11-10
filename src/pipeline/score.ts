import { analyze, type Metrics } from "../metrics/stylometry.js";
import { checkConformance, type ConformanceReport } from "../critic/conformance.js";
import { countWords } from "../util/text.js";
import type { EffectiveVoice } from "../voice/schema.js";

export function scoreText(
  text: string,
  voice: EffectiveVoice,
  names: string[] = [],
): { metrics: Metrics; report: ConformanceReport } {
  const ticPhrases = voice.tics.map((t) => t.phrase);
  const metrics = analyze(text, { names, ticPhrases });
  const report = checkConformance(metrics, voice.targets, voice);
  return { metrics, report };
}

export function wordDeviation(words: number, target: number): number {
  if (target === 0) return 0;
  return Math.abs(words - target) / target;
}

export function cleanProse(text: string): string {
  let out = text.trim();
  out = out.replace(/```[a-z]*\n?/gi, "").replace(/```/g, "").trim();

  // Drop a leading meta sentence if the model announced itself.
  out = out.replace(
    /^(here('| i)s|below is|sure[,.]?|certainly[,.]?)[^\n]*\n+/i,
    "",
  );

  // Drop scene headings and structural labels the model may invent.
  const lines = out.split("\n");
  const kept: string[] = [];
  let started = false;
  for (const line of lines) {
    const isHeading = /^#{1,6}\s/.test(line.trim());
    const isLabel = /^\s*(scene|chapter|part)\s+\d+/i.test(line.trim());
    const isDivider = /^\s*(\*\s*){3,}$/.test(line);
    if (!started && (isHeading || isLabel)) continue;
    if (isDivider) continue;
    if (isHeading) continue;
    if (line.trim().length > 0) started = true;
    kept.push(line);
  }

  out = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return out;
}

export function countWordsSafe(text: string): number {
  return countWords(text);
}
