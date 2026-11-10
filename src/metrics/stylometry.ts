import {
  ABSTRACT_SUFFIXES,
  CONCRETE_HINTS,
  EXOTIC_TAGS,
  FILTER_VERBS,
  HEDGES,
  PRONOUNS_THIRD,
  REGISTER_BREAKERS,
  STOPWORD_NAMES,
} from "./lexicon.js";
import {
  countWords,
  extractDialogue,
  pct,
  round,
  splitParagraphs,
  splitSentences,
  stripMarkdown,
} from "../util/text.js";

export type Band = [number, number];

export type Metrics = {
  words: number;
  sentences: number;
  paragraphs: number;
  meanSentenceWords: number;
  medianSentenceWords: number;
  p90SentenceWords: number;
  shortSentenceRatio: number;
  longSentenceRatio: number;
  veryLongSentenceRatio: number;
  emDashPer1k: number;
  semicolonPer1k: number;
  exclamationPer1k: number;
  ellipsisPer1k: number;
  questionPer1k: number;
  hedgePer1k: number;
  filterVerbPer1k: number;
  abstractionRatio: number;
  similePer1k: number;
  adverbRatio: number;
  dialogueRatio: number;
  dialogueTagCount: number;
  exoticTagCount: number;
  exoticTagRatio: number;
  nameCount: number;
  pronounCount: number;
  nameToPronounRatio: number;
  concretePer1k: number;
  avgParagraphWords: number;
  tics: Record<string, number>;
  breakers: Array<{ phrase: string; count: number; why: string }>;
  detectedNames: string[];
};

export type MetricKey = Exclude<
  keyof Metrics,
  "words" | "sentences" | "paragraphs" | "tics" | "breakers" | "detectedNames" | "nameCount" | "pronounCount" | "dialogueTagCount" | "exoticTagCount"
>;

const SAID_TAGS = ["said", "asked", "replied", "answered", "added", "told"];

function countPhrase(text: string, phrase: string): number {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![\\p{L}])${escaped}(?![\\p{L}])`, "giu");
  return (text.match(re) ?? []).length;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? ((s[mid - 1]! + s[mid]!) / 2) : s[mid]!;
}

function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
  return s[idx]!;
}

export function detectNames(text: string): string[] {
  const tokens = stripMarkdown(text).match(/\b[A-Z][a-z]{2,}\b/g) ?? [];
  const midSentence = new Set<string>();
  const total = new Map<string, number>();

  const re = /\b([A-Z][a-z]{2,})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const name = m[1]!;
    total.set(name, (total.get(name) ?? 0) + 1);
    const prev = text.slice(Math.max(0, m.index - 2), m.index);
    if (/[,;:—-]\s$/.test(prev) || /[a-z]\s$/.test(prev)) {
      midSentence.add(name);
    }
  }

  return [...total.entries()]
    .filter(([name, n]) => n >= 2 && !STOPWORD_NAMES.has(name))
    .filter(([name]) => midSentence.has(name))
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}

export function analyze(
  text: string,
  opts: { names?: string[]; ticPhrases?: string[] } = {},
): Metrics {
  const plain = stripMarkdown(text);
  const words = countWords(plain);
  const sentenceList = splitSentences(text);
  const paras = splitParagraphs(text);
  const lens = sentenceList.map((s) => countWords(s)).filter((n) => n > 0);

  const meanSentenceWords = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
  const short = lens.filter((n) => n <= 8).length;
  const long = lens.filter((n) => n >= 35).length;
  const veryLong = lens.filter((n) => n >= 50).length;

  const dialogue = extractDialogue(text).join(" ");
  const dialogueWords = countWords(dialogue);

  const names = opts.names && opts.names.length > 0 ? opts.names : detectNames(text);
  let nameCount = 0;
  for (const n of names) nameCount += countPhrase(plain, n);
  let pronounCount = 0;
  for (const p of PRONOUNS_THIRD) pronounCount += countPhrase(plain, p);

  let hedge = 0;
  for (const h of HEDGES) hedge += countPhrase(plain, h);
  let filterVerb = 0;
  for (const f of FILTER_VERBS) filterVerb += countPhrase(plain, f);
  let concrete = 0;
  for (const c of CONCRETE_HINTS) concrete += countPhrase(plain, c);

  let exotic = 0;
  for (const t of EXOTIC_TAGS) exotic += countPhrase(plain, t);
  let said = 0;
  for (const t of SAID_TAGS) said += countPhrase(plain, t);

  const wordTokens = plain.match(/[\p{L}][\p{L}'’-]*/gu) ?? [];
  let abstractWords = 0;
  for (const w of wordTokens) {
    const lw = w.toLowerCase();
    if (ABSTRACT_SUFFIXES.some((suf) => lw.length > suf.length + 3 && lw.endsWith(suf))) {
      abstractWords++;
    }
  }

  const simile = (plain.match(/\b(like|as if|as though)\b/giu) ?? []).length;
  const adverb = (plain.match(/\b[\p{L}]+ly\b/giu) ?? []).length;

  const emDash = (plain.match(/—|--/g) ?? []).length;
  const semicolon = (plain.match(/;/g) ?? []).length;
  const exclamation = (plain.match(/!/g) ?? []).length;
  const ellipsis = (plain.match(/…|\.\.\./g) ?? []).length;
  const question = (plain.match(/\?/g) ?? []).length;

  const tics: Record<string, number> = {};
  for (const phrase of opts.ticPhrases ?? []) {
    tics[phrase] = words > 0 ? round(pct(countPhrase(plain, phrase), words) * 10, 3) : 0;
  }

  const rawBreakers = REGISTER_BREAKERS
    .map((b) => ({ ...b, count: countPhrase(plain, b.phrase) }))
    .filter((b) => b.count > 0);

  // Suppress overlapping phrases: "chill ran down" is already inside
  // "a chill ran down". Count the longer match once.
  const breakers = rawBreakers.filter(
    (b) =>
      !rawBreakers.some(
        (other) =>
          other !== b &&
          other.phrase.length > b.phrase.length &&
          other.phrase.toLowerCase().includes(b.phrase.toLowerCase()),
      ),
  ).sort((a, b) => b.count - a.count);

  const per1k = (n: number) => (words > 0 ? round((n / words) * 1000, 2) : 0);

  return {
    words,
    sentences: sentenceList.length,
    paragraphs: paras.length,
    meanSentenceWords: round(meanSentenceWords, 2),
    medianSentenceWords: round(median(lens), 2),
    p90SentenceWords: round(percentile(lens, 90), 2),
    shortSentenceRatio: round(lens.length ? short / lens.length : 0, 3),
    longSentenceRatio: round(lens.length ? long / lens.length : 0, 3),
    veryLongSentenceRatio: round(lens.length ? veryLong / lens.length : 0, 3),
    emDashPer1k: per1k(emDash),
    semicolonPer1k: per1k(semicolon),
    exclamationPer1k: per1k(exclamation),
    ellipsisPer1k: per1k(ellipsis),
    questionPer1k: per1k(question),
    hedgePer1k: per1k(hedge),
    filterVerbPer1k: per1k(filterVerb),
    abstractionRatio: round(words ? abstractWords / words : 0, 4),
    similePer1k: per1k(simile),
    adverbRatio: round(words ? adverb / words : 0, 4),
    dialogueRatio: round(words ? dialogueWords / words : 0, 3),
    dialogueTagCount: said + exotic,
    exoticTagCount: exotic,
    exoticTagRatio: round(exotic / Math.max(1, said + exotic), 3),
    nameCount,
    pronounCount,
    nameToPronounRatio: round(nameCount / Math.max(1, pronounCount), 3),
    concretePer1k: per1k(concrete),
    avgParagraphWords: round(paras.length ? words / paras.length : 0, 1),
    tics,
    breakers,
    detectedNames: names,
  };
}
