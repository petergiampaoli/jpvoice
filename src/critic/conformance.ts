import type { Band, MetricKey, Metrics } from "../metrics/stylometry.js";
import type { EffectiveVoice, Targets } from "../voice/schema.js";

export type Severity = "high" | "medium" | "low";

export type Issue = {
  id: string;
  metric: MetricKey | "tic" | "breaker" | "banned";
  label: string;
  value: number | string;
  band?: Band;
  severity: Severity;
  direction?: "over" | "under";
  fix: string;
  examples?: string[];
};

export type ConformanceReport = {
  score: number;
  pass: boolean;
  issues: Issue[];
  metrics: Metrics;
};

const LABELS: Record<string, string> = {
  meanSentenceWords: "mean sentence length",
  medianSentenceWords: "median sentence length",
  p90SentenceWords: "p90 sentence length",
  shortSentenceRatio: "short-sentence share",
  longSentenceRatio: "long-sentence share",
  veryLongSentenceRatio: "very-long-sentence share",
  emDashPer1k: "em dashes / 1k",
  semicolonPer1k: "semicolons / 1k",
  exclamationPer1k: "exclamation marks / 1k",
  ellipsisPer1k: "ellipses / 1k",
  questionPer1k: "question marks / 1k",
  hedgePer1k: "hedges / 1k",
  filterVerbPer1k: "filter verbs / 1k",
  abstractionRatio: "abstraction ratio",
  similePer1k: "similes / 1k",
  adverbRatio: "adverb ratio",
  dialogueRatio: "dialogue share",
  nameToPronounRatio: "names per pronoun",
  concretePer1k: "concrete words / 1k",
  avgParagraphWords: "mean paragraph length",
};

type FixFn = (dir: "over" | "under", value: number, band: Band) => string;

const FIXES: Partial<Record<string, FixFn>> = {
  meanSentenceWords: (dir) =>
    dir === "over"
      ? "Break long sentences into two. Where a sentence has a subordinate clause, cut the clause and start again."
      : "Join some short sentences with a comma or 'and'. Do not add new material.",
  medianSentenceWords: (dir) =>
    dir === "over" ? "Shorten the middle of the distribution, not just the longest sentences." : "Let some short sentences run on.",
  shortSentenceRatio: (dir) =>
    dir === "under"
      ? "Convert several medium sentences into declaratives of eight words or fewer. Keep the same content."
      : "Join some of the shortest sentences. The text is chopping.",
  longSentenceRatio: (dir) =>
    dir === "over" ? "Split sentences over thirty-five words. There should be very few of them." : "",
  veryLongSentenceRatio: (dir) => (dir === "over" ? "Eliminate sentences over fifty words entirely." : ""),
  emDashPer1k: (dir) => (dir === "over" ? "Replace dashes with full stops or commas." : ""),
  semicolonPer1k: (dir) => (dir === "over" ? "Replace semicolons with full stops." : "A semicolon may replace a comma splice where two clauses are balanced."),
  exclamationPer1k: (dir) => (dir === "over" ? "Remove exclamation marks. Render the emphasis as a flat statement." : ""),
  ellipsisPer1k: (dir) => (dir === "under" ? "Use an ellipsis where a character does not speak, or where a thought is abandoned." : "Remove ellipses that are only hesitations."),
  questionPer1k: (dir) => (dir === "under" ? "Allow a character to ask a direct question and receive an indirect answer." : "Convert some questions to statements."),
  hedgePer1k: (dir) =>
    dir === "under"
      ? "Permit the register's hedges: 'perhaps', 'a little', 'somehow', 'it seemed'. Do not overuse them."
      : "Remove the surplus hedges. Keep at most one uncertainty marker per paragraph.",
  filterVerbPer1k: (dir) =>
    dir === "under"
      ? "Report perception directly: 'He looked at the door.' 'The sound reached him.' These verbs are native to the register."
      : "Cut the perception frame and present the thing itself.",
  abstractionRatio: (dir) =>
    dir === "over"
      ? "Replace nominalisations with concrete nouns and events. 'The realisation came' becomes 'He understood, and said nothing.'"
      : "",
  similePer1k: (dir) => (dir === "over" ? "Delete similes. Replace each with a fact or an object." : ""),
  adverbRatio: (dir) => (dir === "over" ? "Remove -ly adverbs. Let the verb or the object carry it." : ""),
  dialogueRatio: (dir) =>
    dir === "under"
      ? "Dramatise more of the scene as speech. Let the exchange run without narration between the lines."
      : "Summarise some of the dialogue and return to narration. Not every exchange needs to be quoted.",
  nameToPronounRatio: (dir) =>
    dir === "under"
      ? "Repeat the character's name instead of 'he' or 'she'. This repetition is the voice."
      : "Replace some repeated names with pronouns where the referent is unambiguous.",
  concretePer1k: (dir) =>
    dir === "under"
      ? "Inventory the room: objects on the table, the weather, the hour, what a hand is doing."
      : "Reduce the object inventory. Keep the two or three things that matter.",
  avgParagraphWords: (dir) =>
    dir === "over" ? "Break long paragraphs at the point where attention shifts." : "Let some paragraphs group two or three sentences of the same beat.",
};

function bandWidth(b: Band): number {
  return Math.max(0.4, b[1] - b[0]);
}

function severityFor(
  value: number,
  band: Band,
  words: number,
): { severity: Severity; direction: "over" | "under" } | null {
  const [lo, hi] = band;
  if (value >= lo && value <= hi) return null;
  const dir: "over" | "under" = value < lo ? "under" : "over";
  const dist = dir === "under" ? lo - value : value - hi;
  const ratio = dist / bandWidth(band);
  let severity: Severity = ratio > 1 ? "high" : ratio > 0.35 ? "medium" : "low";

  // Rate metrics are coarse on short passages: one em dash in 200 words is 5/1k.
  // Do not shout about a difference that is within a single occurrence.
  const occurrences = (dist / 1000) * words;
  if (occurrences < 1.5 && severity === "high") severity = "medium";
  if (words < 300 && severity === "medium") severity = "low";

  return { severity, direction: dir };
}

const PENALTY: Record<Severity, number> = { high: 10, medium: 5, low: 2 };

export function checkConformance(
  metrics: Metrics,
  targets: Targets,
  voice: EffectiveVoice,
): ConformanceReport {
  const issues: Issue[] = [];

  for (const [key, band] of Object.entries(targets)) {
    if (!Array.isArray(band)) continue;
    const value = (metrics as Record<string, unknown>)[key];
    if (typeof value !== "number") continue;
    const verdict = severityFor(value, band as Band, metrics.words);
    if (!verdict) continue;
    const fixFn = FIXES[key];
    const fix = fixFn ? fixFn(verdict.direction, value, band as Band) : "";
    if (!fix) continue;
    issues.push({
      id: `${key}:${verdict.direction}`,
      metric: key as MetricKey,
      label: LABELS[key] ?? key,
      value,
      band: band as Band,
      severity: verdict.severity,
      direction: verdict.direction,
      fix,
    });
  }

  // Tic ceilings. Compare absolute counts with a floor of one, because a
  // per-1k ceiling is meaningless on a 300-word passage.
  for (const tic of voice.tics) {
    const rate = metrics.tics[tic.phrase] ?? 0;
    const count = (rate * metrics.words) / 1000;
    const allowed = Math.max(1, (tic.per1kMax * metrics.words) / 1000);
    if (count > allowed + 0.001) {
      issues.push({
        id: `tic:${tic.phrase}`,
        metric: "tic",
        label: `tic "${tic.phrase}"`,
        value: Math.round(count),
        band: [0, Number(allowed.toFixed(2))],
        severity: count > allowed * 2 ? "medium" : "low",
        direction: "over",
        fix: `"${tic.phrase}" appears ${Math.round(count)} time(s) where ${Number(allowed.toFixed(1))} is the allowance for this length. Replace the surplus with a plain statement or delete the sentence.`,
      });
    }
  }

  // Hard bans. A register breaker is discrete: one occurrence is already a
  // violation, not a rate to be averaged.
  for (const breaker of metrics.breakers) {
    issues.push({
      id: `breaker:${breaker.phrase}`,
      metric: "breaker",
      label: `register breaker "${breaker.phrase}"`,
      value: breaker.count,
      severity: "high",
      fix: `Rewrite without "${breaker.phrase}" (${breaker.why}). Replace it with a concrete fact, a gesture, or a flat statement.`,
      examples: breaker.examples,
    });
  }

  const scored = issues;
  const penalty = scored.reduce((sum, i) => sum + PENALTY[i.severity], 0);
  const score = Math.max(0, 100 - penalty);

  return {
    score,
    pass: scored.filter((i) => i.severity !== "low").length === 0,
    issues: scored.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 } as const;
      return order[a.severity] - order[b.severity];
    }),
    metrics,
  };
}

export function critiquePrompt(report: ConformanceReport): string {
  if (report.issues.length === 0) return "";
  const lines: string[] = [];
  const hard = report.issues.filter((i) => i.metric === "breaker" || i.metric === "tic" || i.severity === "high");
  const rest = report.issues.filter((i) => !hard.includes(i));

  lines.push("# CONFORMANCE REPORT");
  lines.push(
    `This draft is at ${report.score}/100 against the voice contract. ${hard.length} item(s) are mandatory failures.`,
  );
  lines.push("");

  if (hard.length) {
    lines.push(`## MANDATORY — these must not survive`);
    lines.push(
      `A sentence containing a banned phrase below must be deleted or rewritten. Do not leave it unchanged. Do not paraphrase it back into the same shape.`,
    );
    lines.push("");
    for (const issue of hard) {
      lines.push(`### ${issue.label}`);
      if (issue.band) lines.push(`Current: ${issue.value}. Target: ${issue.band[0]}–${issue.band[1]}.`);
      else lines.push(`Current: ${issue.value}.`);
      if (issue.examples?.length) {
        for (const ex of issue.examples) lines.push(`Offending sentence: "${ex}"`);
      }
      lines.push(`Fix: ${issue.fix}`);
      lines.push("");
    }
  }

  if (rest.length) {
    lines.push(`## LINE EDITS`);
    for (const issue of rest) {
      lines.push(`- ${issue.label}: ${issue.value}${issue.band ? ` (target ${issue.band[0]}–${issue.band[1]})` : ""}`);
      lines.push(`  ${issue.fix}`);
    }
    lines.push("");
  }

  lines.push("Rules for the revision:");
  lines.push("- Preserve every event, line of dialogue, and fact. Change only the prose.");
  lines.push("- You are preserving events, not sentences. A sentence that carries a banned phrase is not protected.");
  lines.push("- Delete rather than decorate. If a fix requires removing a sentence, remove it.");
  lines.push("- Do not add new scenes, characters, information, adjectives, or similes.");
  lines.push("- Fix the mandatory items first. Then the line edits.");
  lines.push("- Return the complete revised scene, prose only.");
  return lines.join("\n");
}
