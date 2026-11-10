import { chat, extractJson } from "../llm/client.js";
import { countWords, splitParagraphs } from "../util/text.js";
import { cleanProse } from "./score.js";
import type { EffectiveVoice } from "../voice/schema.js";
import { renderVoiceSpec } from "../voice/render.js";

const EXPANSION_MENU = `Add material ONLY from this menu:
- a beat of quotidian procedure (making tea, lighting a cigarette, the walk to the station)
- an explicit interval of time ("For a while neither of them spoke.")
- object inventory (what is on the table, what the room contains)
- one more exchange of dialogue, with the politeness of the register
- weather or season, stated flatly
- a body or gesture observation, with no interpretation
- a flat emotional statement arriving after the fact
- a memory fragment, delivered without framing
- a minor character's small action

Never add a new event, character, or fact. Never add adjectives, similes, or an explanation of an existing image.`;

const COMPRESSION_MENU = `Compress ONLY by:
- merging sentence chains into shorter declaratives
- deleting subordinate clauses and adverbial hedges
- deleting explanatory interiority
- deleting similes
- removing redundant time anchors
- summarising a minor exchange instead of quoting it

Do not remove any event, any fact, or any line of dialogue that carries information.`;

const INSERTION_SYSTEM = `You lengthen an existing passage without rewriting it. You return JSON only.

${EXPANSION_MENU}

Return this shape exactly:
{"insertions":[{"after":<paragraph number>,"text":"<prose>"}]}

"after" is the 1-based number of the existing paragraph the new material follows. Each insertion must be 40 to 120 words. Do not rewrite, reorder, or reproduce the existing paragraphs.`;

const COMPRESS_SYSTEM = `You compress an existing passage in a fixed register. Preserve every event, fact, and line of dialogue that carries information.

${COMPRESSION_MENU}`;

function chunkText(text: string, targetWords: number): string[] {
  const paras = splitParagraphs(text);
  const chunks: string[] = [];
  let current: string[] = [];
  let count = 0;
  for (const p of paras) {
    const w = countWords(p);
    if (count > 0 && count + w > targetWords * 1.4) {
      chunks.push(current.join("\n\n"));
      current = [];
      count = 0;
    }
    current.push(p);
    count += w;
  }
  if (current.length) chunks.push(current.join("\n\n"));
  return chunks.filter((c) => countWords(c) > 0);
}

/**
 * Expansion is surgical: the existing prose is never rewritten, only
 * interleaved with new material. This preserves the draft and makes the
 * added word count controllable.
 */
async function expandWithInsertions(args: {
  text: string;
  voice: EffectiveVoice;
  addWords: number;
}): Promise<string> {
  const paragraphs = splitParagraphs(args.text);
  if (paragraphs.length === 0) return args.text;

  const numbered = paragraphs.map((p, i) => `[${i + 1}] ${p}`).join("\n\n");

  const res = await chat({
    messages: [
      {
        role: "system",
        content: INSERTION_SYSTEM + "\n\n# VOICE CONTRACT\n" + renderVoiceSpec(args.voice),
      },
      {
        role: "user",
        content: [
          `Add approximately ${args.addWords} words in total.`,
          `That is roughly ${Math.max(2, Math.round(args.addWords / 70))} insertions.`,
          ``,
          `# EXISTING PARAGRAPHS`,
          numbered,
        ].join("\n"),
      },
    ],
    tier: "flash",
    temperature: 0.9,
    maxTokens: Math.min(6000, Math.round(args.addWords * 3) + 1200),
    json: true,
    tag: "expand",
  });

  try {
    const parsed = extractJson<{ insertions?: Array<{ after?: number; text?: string }> }>(res.text);
    const insertions = (parsed.insertions ?? [])
      .filter((x) => typeof x.after === "number" && typeof x.text === "string" && x.text.trim().length > 0)
      .map((x) => ({
        after: Math.max(0, Math.min(paragraphs.length, Math.round(x.after as number))),
        text: cleanProse(x.text as string),
      }));

    if (insertions.length === 0) return args.text;

    const out: string[] = [];
    for (let i = 1; i <= paragraphs.length; i++) {
      out.push(paragraphs[i - 1]!);
      for (const ins of insertions.filter((x) => x.after === i)) out.push(ins.text);
    }
    return out.join("\n\n");
  } catch {
    return args.text;
  }
}

async function compressChunk(args: {
  chunk: string;
  voice: EffectiveVoice;
  target: number;
}): Promise<string> {
  const res = await chat({
    messages: [
      {
        role: "system",
        content: COMPRESS_SYSTEM + "\n\n# VOICE CONTRACT\n" + renderVoiceSpec(args.voice),
      },
      {
        role: "user",
        content: [
          `Target length: ${args.target} words. Hard maximum: ${Math.round(args.target * 1.08)} words.`,
          `Return prose only. Do not add headings.`,
          ``,
          `# PASSAGE`,
          args.chunk,
        ].join("\n"),
      },
    ],
    tier: "flash",
    temperature: 0.4,
    maxTokens: Math.min(6000, Math.round(args.target * 2.2) + 1200),
    tag: "compress",
  });

  const revised = cleanProse(res.text);
  if (!revised || countWords(revised) < 30) return args.chunk;
  return countWords(revised) < countWords(args.chunk) ? revised : args.chunk;
}

export async function rescaleText(args: {
  text: string;
  voice: EffectiveVoice;
  toWords: number;
  chunkWords?: number;
}): Promise<{ text: string; before: number; after: number; calls: number }> {
  const before = countWords(args.text);
  const ratio = args.toWords / Math.max(1, before);
  const mode = ratio > 1.02 ? "expand" : ratio < 0.98 ? "compress" : "none";

  if (mode === "none") {
    return { text: args.text, before, after: before, calls: 0 };
  }

  if (mode === "expand") {
    let best = args.text;
    let calls = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const need = args.toWords - countWords(best);
      if (need <= args.toWords * 0.06) break;
      const next = await expandWithInsertions({ text: best, voice: args.voice, addWords: need });
      calls++;
      if (countWords(next) <= countWords(best)) break;
      best = next;
      if (Math.abs(countWords(best) - args.toWords) / args.toWords <= 0.08) break;
    }
    return { text: best, before, after: countWords(best), calls };
  }

  const chunks = chunkText(args.text, args.chunkWords ?? 1200);
  const totalBefore = chunks.reduce((s, c) => s + countWords(c), 0);
  const out: string[] = [];
  let calls = 0;

  for (const chunk of chunks) {
    const cw = countWords(chunk);
    const target = Math.max(40, Math.round((cw / Math.max(1, totalBefore)) * args.toWords));
    out.push(await compressChunk({ chunk, voice: args.voice, target }));
    calls++;
  }

  return { text: out.join("\n\n"), before, after: countWords(out.join("\n\n")), calls };
}
