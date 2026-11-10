import type { EffectiveVoice } from "./schema.js";

const LABELS: Record<string, string> = {
  meanSentenceWords: "mean sentence length (words)",
  medianSentenceWords: "median sentence length",
  p90SentenceWords: "90th percentile sentence length",
  shortSentenceRatio: "share of sentences ≤ 8 words",
  longSentenceRatio: "share of sentences ≥ 35 words",
  veryLongSentenceRatio: "share of sentences ≥ 50 words",
  emDashPer1k: "em dashes per 1,000 words",
  semicolonPer1k: "semicolons per 1,000 words",
  exclamationPer1k: "exclamation marks per 1,000 words",
  ellipsisPer1k: "ellipses per 1,000 words",
  questionPer1k: "question marks per 1,000 words",
  hedgePer1k: "hedges per 1,000 words",
  filterVerbPer1k: "perception/filter verbs per 1,000 words",
  abstractionRatio: "abstraction ratio (nominalisations ÷ words)",
  similePer1k: "similes per 1,000 words",
  adverbRatio: "adverb (-ly) ratio",
  dialogueRatio: "dialogue share of words",
  nameToPronounRatio: "names per pronoun",
  concretePer1k: "concrete-object words per 1,000 words",
  avgParagraphWords: "mean paragraph length",
};

export function renderVoiceSpec(v: EffectiveVoice): string {
  const lines: string[] = [];

  lines.push(`# VOICE CONTRACT`);
  lines.push(`Register: ${v.label}`);
  lines.push(`Pairing status: ${v.status}${v.status === "synthetic" ? " (extrapolated — not a historical translation)" : ""}`);
  lines.push(`Form: ${v.form.label}`);
  lines.push(`Point of view: ${v.pov}. Tense: ${v.tense}.`);
  lines.push("");
  lines.push(`## The register`);
  lines.push(v.author.summary.trim());
  lines.push("");
  lines.push(v.translator.register.trim());
  lines.push("");

  lines.push(`## Hard rules`);
  for (const d of v.directives) lines.push(`- ${d}`);
  lines.push("");

  const targetEntries = Object.entries(v.targets).filter(([, band]) => Array.isArray(band));
  if (targetEntries.length) {
    lines.push(`## Measured targets (enforced after drafting)`);
    for (const [key, band] of targetEntries) {
      const b = band as [number, number];
      lines.push(`- ${LABELS[key] ?? key}: ${b[0]}–${b[1]}`);
    }
    lines.push("");
  }

  if (v.lexicon.prefer.length) {
    lines.push(`## Prefer`);
    lines.push(v.lexicon.prefer.join(", "));
    lines.push("");
  }
  if (v.lexicon.avoid.length) {
    lines.push(`## Avoid`);
    lines.push(v.lexicon.avoid.join(", "));
    lines.push("");
  }
  if (v.lexicon.banned.length) {
    lines.push(`## Never use`);
    for (const b of v.lexicon.banned) lines.push(`- "${b}"`);
    lines.push("");
  }

  if (v.tics.length) {
    lines.push(`## Tic ceilings (per chapter, enforced)`);
    lines.push("These constructions are correct in this voice but become parody when overused.");
    for (const t of v.tics) lines.push(`- "${t.phrase}": at most ${t.per1kMax} per 1,000 words`);
    lines.push("");
  }

  lines.push(`## Dialogue`);
  lines.push(`- Tags: ${v.dialogue.tags.join(", ")} only. Tag variety: ${v.dialogue.tag_variety}.`);
  lines.push(`- Honorifics and kin terms: ${v.dialogue.honorifics}.`);
  lines.push(`- Sentence-final particles render as: ${v.dialogue.particles}.`);
  lines.push("");

  if (v.exemplars.length) {
    lines.push(`## Contrastive moves`);
    lines.push("Native-English literary default → this register.");
    for (const ex of v.exemplars) {
      lines.push(`- BEFORE: ${ex.before}`);
      lines.push(`  AFTER: ${ex.after}${ex.note ? `   (${ex.note})` : ""}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function renderSceneContract(opts: {
  words: number;
  tolerance?: number;
  beat: string;
  pov: string;
  tense: string;
}): string {
  const tol = opts.tolerance ?? 0.1;
  const lo = Math.round(opts.words * (1 - tol));
  const hi = Math.round(opts.words * (1 + tol));
  return [
    `# SCENE CONTRACT`,
    `Target length: ${opts.words} words. Acceptable: ${lo}–${hi}. Hard ceiling: ${hi}.`,
    `Point of view: ${opts.pov}. Tense: ${opts.tense}.`,
    ``,
    `# BEAT TO DRAMATISE`,
    opts.beat.trim(),
    ``,
    `Write prose only. No headings, no scene numbers, no commentary, no summary.`,
    `Do not end with a moral, a revelation, or a lift. End on an object or a fact.`,
  ].join("\n");
}
