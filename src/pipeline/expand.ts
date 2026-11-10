import { chat } from "../llm/client.js";
import { countWords, splitParagraphs } from "../util/text.js";
import { cleanProse } from "./score.js";
import type { EffectiveVoice } from "../voice/schema.js";
import { renderVoiceSpec } from "../voice/render.js";

const EXPANSION_MENU = `You may lengthen the passage ONLY by using these moves:
- a beat of quotidian procedure (making tea, lighting a cigarette, the walk to the station)
- an explicit interval of time ("For a while neither of them spoke.")
- object inventory (what is on the table, what the room contains)
- one more exchange of dialogue, with the politeness of the register
- weather or season, stated flatly
- a body or gesture observation, with no interpretation
- splitting one long sentence into two short paratactic ones
- a flat emotional statement arriving after the fact
- a memory fragment, delivered without framing
- a minor character's small action

You may NOT:
- add a new event, character, or piece of information
- add adjectives, similes, or metaphors
- explain an existing image
- raise the emotional temperature`;

const COMPRESSION_MENU = `Compress ONLY by:
- merging sentence chains into shorter declaratives
- deleting subordinate clauses and adverbial hedges
- deleting explanatory interiority
- deleting similes
- removing redundant time anchors
- summarising a minor exchange instead of quoting it

Do not remove any event, any fact, or any line of dialogue that carries information.`;

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

export async function rescaleText(args: {
  text: string;
  voice: EffectiveVoice;
  toWords: number;
  chunkWords?: number;
}): Promise<{ text: string; before: number; after: number; chunks: number }> {
  const before = countWords(args.text);
  const ratio = args.toWords / Math.max(1, before);
  const mode = ratio > 1.02 ? "expand" : ratio < 0.98 ? "compress" : "none";

  if (mode === "none") {
    return { text: args.text, before, after: before, chunks: 0 };
  }

  const chunks = chunkText(args.text, args.chunkWords ?? 1400);
  const totalBefore = chunks.reduce((s, c) => s + countWords(c), 0);
  const out: string[] = [];

  for (const chunk of chunks) {
    const cw = countWords(chunk);
    const target = Math.max(60, Math.round((cw / Math.max(1, totalBefore)) * args.toWords));
    const res = await chat({
      messages: [
        {
          role: "system",
          content:
            `You are revising a passage into a measured prose register. Preserve the story exactly. Change only length and texture.\n\n# VOICE CONTRACT\n` +
            renderVoiceSpec(args.voice) +
            `\n\n# ${mode === "expand" ? "EXPANSION" : "COMPRESSION"} RULES\n` +
            (mode === "expand" ? EXPANSION_MENU : COMPRESSION_MENU),
        },
        {
          role: "user",
          content: [
            `Target length: ${target} words. Acceptable: ${Math.round(target * 0.9)}–${Math.round(target * 1.1)}.`,
            `Return prose only. Do not add headings.`,
            ``,
            `# PASSAGE`,
            chunk,
          ].join("\n"),
        },
      ],
      tier: "flash",
      temperature: mode === "expand" ? 0.9 : 0.5,
      tag: mode,
    });

    let revised = cleanProse(res.text);
    if (!revised || Math.abs(countWords(revised) - target) / target > 0.4) {
      revised = chunk;
    }
    out.push(revised);
  }

  const text = out.join("\n\n");
  return { text, before, after: countWords(text), chunks: chunks.length };
}
