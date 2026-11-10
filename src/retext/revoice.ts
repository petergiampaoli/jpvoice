import { chat, extractJson } from "../llm/client.js";
import { countWords, splitParagraphs } from "../util/text.js";
import { cleanProse } from "../pipeline/score.js";
import type { Bible } from "../store/project.js";
import type { EffectiveVoice } from "../voice/schema.js";
import { renderVoiceSpec } from "../voice/render.js";

export type RevoiceMode = "polish" | "revoice" | "embellish";

export type RevoiceResult = {
  text: string;
  bible: Bible;
  before: number;
  after: number;
  chunks: number;
  entitiesMissing: string[];
  entitiesChecked: number;
};

function segment(text: string, targetWords: number): string[] {
  const paras = splitParagraphs(text);
  const chunks: string[] = [];
  let current: string[] = [];
  let count = 0;
  for (const p of paras) {
    const w = countWords(p);
    if (count > 0 && count + w > targetWords * 1.3) {
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

export async function extractBible(text: string): Promise<Bible> {
  const body = text.length > 24000 ? text.slice(0, 24000) : text;
  const res = await chat({
    messages: [
      {
        role: "system",
        content:
          "You extract structured story state. Return JSON only. Be literal and conservative: record only what the text states or clearly implies.",
      },
      {
        role: "user",
        content: [
          "Extract the story bible from this text.",
          `Return: {"entities":[{"name","role","note"}],"facts":[string],"threads":[string],"events":[string],"knowledge":[{"character","knows"}]}`,
          "Limit facts to 20, events to 20, threads to 10.",
          "",
          "# TEXT",
          body,
        ].join("\n"),
      },
    ],
    tier: "pro",
    temperature: 0.2,
    json: true,
    tag: "bible",
  });

  try {
    const parsed = extractJson<Partial<Bible>>(res.text);
    return {
      entities: parsed.entities ?? [],
      facts: parsed.facts ?? [],
      threads: parsed.threads ?? [],
      events: parsed.events ?? [],
      knowledge: parsed.knowledge ?? [],
    };
  } catch {
    return { entities: [], facts: [], threads: [], events: [], knowledge: [] };
  }
}

function modeInstruction(mode: RevoiceMode): string {
  switch (mode) {
    case "polish":
      return `Light touch. Keep the sentences as they are wherever possible. Change only what violates the voice contract: register breakers, English idioms, over-written interiority, rhetorical crescendos. Do not restructure. Do not add anything.`;
    case "revoice":
      return `Full register change. Rewrite the prose completely in the voice contract while preserving every event, every fact, and every line of dialogue's meaning. You may merge or split sentences freely. You may not add events.`;
    case "embellish":
      return `Full register change plus expansion. Rewrite in the voice contract, preserve every event and fact, and add length only through the register's legal moves: quotidian procedure, explicit time intervals, object inventory, one more exchange of dialogue, weather, gesture. Do not add new events or characters. Do not add adjectives or similes.`;
  }
}

export async function revoiceText(args: {
  text: string;
  voice: EffectiveVoice;
  mode: RevoiceMode;
  bible?: Bible;
  expandBy?: number;
  chunkWords?: number;
}): Promise<RevoiceResult> {
  const before = countWords(args.text);
  const bible = args.bible ?? (await extractBible(args.text));
  const chunks = segment(args.text, args.chunkWords ?? 1200);
  const expandBy = args.expandBy ?? (args.mode === "embellish" ? 0.3 : 0);
  const out: string[] = [];

  const entityList = bible.entities.map((e) => `${e.name} (${e.role})`).join(", ");

  for (const chunk of chunks) {
    const cw = countWords(chunk);
    const target = Math.round(cw * (1 + expandBy));
    const res = await chat({
      messages: [
        {
          role: "system",
          content:
            `You are re-voicing existing prose into a fixed register.\n\n` +
            `# ${modeInstruction(args.mode)}\n\n` +
            `# LOCKED STORY STATE\n${entityList ? `Entities: ${entityList}` : "Entities: none recorded"}\n` +
            (bible.facts.length ? `Facts that must survive:\n${bible.facts.map((f) => `- ${f}`).join("\n")}` : "") +
            `\n\n# VOICE CONTRACT\n` +
            renderVoiceSpec(args.voice),
        },
        {
          role: "user",
          content: [
            `Target length: ${target} words (original ${cw}).`,
            `Return prose only. No headings, no commentary, no notes about what you changed.`,
            ``,
            `# SOURCE`,
            chunk,
          ].join("\n"),
        },
      ],
      tier: "flash",
      temperature: args.mode === "polish" ? 0.4 : 0.9,
      tag: "revoice",
    });

    const revised = cleanProse(res.text);
    out.push(revised.length > 30 ? revised : chunk);
  }

  const text = out.join("\n\n");
  const names = bible.entities.map((e) => e.name).filter(Boolean);
  const entitiesMissing = names.filter((n) => !new RegExp(`\\b${escapeRegex(n)}\\b`).test(text));

  return {
    text,
    bible,
    before,
    after: countWords(text),
    chunks: chunks.length,
    entitiesMissing,
    entitiesChecked: names.length,
  };
}

export async function continueText(args: {
  text: string;
  voice: EffectiveVoice;
  words: number;
  bible?: Bible;
}): Promise<string> {
  const bible = args.bible ?? (await extractBible(args.text));
  const tail = args.text.slice(-6000);
  const res = await chat({
    messages: [
      {
        role: "system",
        content:
          "You continue an existing work in its established register. You do not summarise, restate, or conclude. You continue.\n\n# VOICE CONTRACT\n" +
          renderVoiceSpec(args.voice),
      },
      {
        role: "user",
        content: [
          `Continue for approximately ${args.words} words.`,
          bible.facts.length ? `Established facts:\n${bible.facts.map((f) => `- ${f}`).join("\n")}` : "",
          bible.threads.length ? `Open threads:\n${bible.threads.map((t) => `- ${t}`).join("\n")}` : "",
          `Return prose only.`,
          ``,
          `# TEXT SO FAR (ending)`,
          tail,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    tier: "flash",
    temperature: 0.95,
    tag: "extend",
  });
  return cleanProse(res.text);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
