import { loadAuthors, loadTranslators } from "../voice/load.js";

export type Brief = {
  words?: number;
  pov?: "first" | "third-limited" | "third-omniscient";
  tense?: "past" | "present";
  form?: string;
  voiceKey?: string;
  title?: string;
};

/** Parse a free-form brief: "first person, 3000 words, kawabata-ish". */
export function parseBrief(brief: string): Brief {
  const out: Brief = {};
  const lower = brief.toLowerCase();

  const wordMatch =
    lower.match(/(\d[\d,]*)\s*(?:k|thousand)\s*words?/) ??
    lower.match(/(\d[\d,]*)\s*words?/);
  if (wordMatch) {
    let n = Number(wordMatch[1]!.replace(/,/g, ""));
    if (/k|thousand/.test(wordMatch[0])) n *= 1000;
    if (Number.isFinite(n) && n > 0) out.words = n;
  }

  if (/first[\s-]?person/.test(lower)) out.pov = "first";
  else if (/third[\s-]?person/.test(lower)) out.pov = "third-limited";

  if (/present tense/.test(lower)) out.tense = "present";
  else if (/past tense/.test(lower)) out.tense = "past";

  if (/flash/.test(lower)) out.form = "flash";
  else if (/novella/.test(lower)) out.form = "novella";
  else if (/novel/.test(lower)) out.form = "novel";
  else if (/short story/.test(lower)) out.form = "short";

  const slash = brief.match(/\b([a-z][a-z'-]+)\/([a-z][a-z'-]+)\b/);
  if (slash) {
    const authors = loadAuthors().map((a) => a.id);
    const translators = loadTranslators().map((t) => t.id);
    if (authors.includes(slash[1]!) && translators.includes(slash[2]!)) {
      out.voiceKey = `${slash[1]}/${slash[2]}`;
    }
  } else {
    const authors = loadAuthors();
    for (const a of authors) {
      const needle = a.id.replace(/-/g, "[ -]?");
      if (new RegExp(`\\b${needle}\\b`, "i").test(brief)) {
        const pair = canonicalFor(a.id);
        if (pair) out.voiceKey = pair;
        break;
      }
    }
  }

  return out;
}

function canonicalFor(authorId: string): string | undefined {
  const defaults: Record<string, string> = {
    kawabata: "kawabata/seidensticker",
    mishima: "mishima/keene",
    tanizaki: "tanizaki/seidensticker",
    dazai: "dazai/keene",
    abe: "abe/saunders",
    oe: "oe/nathan",
    murakami: "murakami/rubin",
    murata: "murata/takemori",
    kawakami: "kawakami/bett-boyd",
  };
  return defaults[authorId];
}
