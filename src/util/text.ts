const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "st", "no", "vs", "etc", "jr", "sr",
  "prof", "rev", "gen", "lt", "sgt", "capt", "col", "fig", "vol",
  "ch", "p", "pp", "e.g", "i.e", "approx", "dept", "est",
]);

/** Count words the way a writer counts them (MS Word-ish). */
export function countWords(text: string): number {
  const plain = stripMarkdown(text);
  const tokens = plain.trim().split(/\s+/).filter(Boolean);
  let n = 0;
  for (const t of tokens) {
    if (/[\p{L}\p{N}]/u.test(t)) n++;
  }
  return n;
}

export function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "");
}

/** Split prose into sentences, preserving dialogue punctuation. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  const src = stripMarkdown(text).replace(/\r/g, "");

  for (const rawPara of src.split(/\n+/)) {
    const para = rawPara.trim();
    if (!para) continue;
    if (/^[-–—*•]{3,}$/.test(para)) continue;

    let start = 0;
    const re = /[.!?…]+["'”’)\]]*(?=\s+)/g;
    let m: RegExpExecArray | null;

    while ((m = re.exec(para))) {
      const rawLastWord = para.slice(0, m.index).match(/([\p{L}.]+)$/u)?.[1] ?? "";
      const lastWord = rawLastWord.toLowerCase().replace(/\.$/, "");
      if (ABBREVIATIONS.has(lastWord)) continue;
      if (/^\p{Lu}$/u.test(rawLastWord)) continue; // initials: J. Smith

      const end = m.index + m[0].length;
      const rest = para.slice(end).trimStart();
      if (!rest) continue;
      // A new sentence must start with a capital, a digit, or an opening quote.
      if (!/["'“‘(\p{Lu}\p{N}]/u.test(rest[0]!)) continue;

      out.push(para.slice(start, end).trim());
      start = end;
      re.lastIndex = end;
    }

    const tail = para.slice(start).trim();
    if (tail) out.push(tail);
  }

  return out.filter((s) => countWords(s) > 0);
}

/** Paragraphs with the markdown decoration removed. */
export function splitParagraphs(text: string): string[] {
  return stripMarkdown(text)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** Quoted spans, tolerant of unclosed dialogue lines. */
export function extractDialogue(text: string): string[] {
  const spans: string[] = [];
  for (const para of splitParagraphs(text)) {
    const re = /["“]([^"”]*)(["”]|$)/g;
    let m: RegExpExecArray | null;
    let found = false;
    while ((m = re.exec(para))) {
      const body = m[1] ?? "";
      if (body.trim()) {
        spans.push(body.trim());
        found = true;
      }
      if (!m[2]) break;
    }
    if (!found && /^["“]/.test(para)) spans.push(para.replace(/^["“]/, "").trim());
  }
  return spans;
}

export function pct(part: number, whole: number): number {
  if (whole === 0) return 0;
  return (part / whole) * 100;
}

export function round(n: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
