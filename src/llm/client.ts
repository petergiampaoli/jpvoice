import { appendFileSync } from "node:fs";
import { loadConfig, requireKey, type Config } from "../config.js";
import { countWords } from "../util/text.js";

export type Role = "system" | "user" | "assistant";
export type Msg = { role: Role; content: string };

export type ChatOpts = {
  messages: Msg[];
  tier?: "flash" | "pro";
  model?: string;
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  tag?: string;
};

export type ChatResult = {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  ms: number;
  mocked: boolean;
};

let logPath: string | null = null;
let sessionCost = 0;

export function setLogPath(path: string | null): void {
  logPath = path;
}

export function totalCost(): number {
  return sessionCost;
}

export function resetCost(): void {
  sessionCost = 0;
}

function approxTokens(s: string): number {
  return Math.ceil(s.length / 3.6);
}

function log(entry: Record<string, unknown>): void {
  if (!logPath) return;
  try {
    appendFileSync(logPath, JSON.stringify(entry) + "\n");
  } catch {
    /* logging must never break a run */
  }
}

function backoff(attempt: number): number {
  return Math.min(20_000, 800 * 2 ** attempt + Math.random() * 400);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export async function chat(opts: ChatOpts): Promise<ChatResult> {
  const cfg = loadConfig();
  const tier = opts.tier ?? "flash";
  const model = opts.model ?? cfg.models[tier];
  const started = Date.now();

  if (cfg.mock) {
    const text = mockResponse(opts);
    const inputTokens = approxTokens(opts.messages.map((m) => m.content).join("\n"));
    const outputTokens = approxTokens(text);
    log({
      ts: new Date().toISOString(),
      tag: opts.tag ?? "chat",
      model: `mock:${tier}`,
      inputTokens,
      outputTokens,
      ms: Date.now() - started,
      mocked: true,
    });
    return {
      text,
      model: `mock:${tier}`,
      inputTokens,
      outputTokens,
      costUsd: 0,
      ms: Date.now() - started,
      mocked: true,
    };
  }

  const key = requireKey(cfg);
  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.9,
    max_tokens: opts.maxTokens ?? cfg.maxTokens,
    stream: false,
  };
  if (opts.json) body.response_format = { type: "json_object" };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
      });

      if (res.status === 429 || res.status >= 500) {
        const text = await res.text();
        lastError = new Error(`DeepSeek ${res.status}: ${text.slice(0, 400)}`);
        await sleep(backoff(attempt));
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`DeepSeek ${res.status}: ${text.slice(0, 800)}`);
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = data.choices?.[0]?.message?.content ?? "";
      const inputTokens = data.usage?.prompt_tokens ?? approxTokens(opts.messages.map((m) => m.content).join("\n"));
      const outputTokens = data.usage?.completion_tokens ?? approxTokens(text);
      const price = cfg.pricing[tier];
      const costUsd = (inputTokens / 1e6) * price.in + (outputTokens / 1e6) * price.out;
      sessionCost += costUsd;

      log({
        ts: new Date().toISOString(),
        tag: opts.tag ?? "chat",
        model,
        tier,
        inputTokens,
        outputTokens,
        costUsd,
        ms: Date.now() - started,
      });

      return {
        text,
        model,
        inputTokens,
        outputTokens,
        costUsd,
        ms: Date.now() - started,
        mocked: false,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === 3) break;
      await sleep(backoff(attempt));
    }
  }

  throw lastError ?? new Error("DeepSeek request failed");
}

/** Extract the first JSON object or array from a model response. */
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error(`No JSON found in response: ${text.slice(0, 200)}`);
  const opener = candidate[start];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) return JSON.parse(candidate.slice(start, i + 1)) as T;
    }
  }
  throw new Error(`Unbalanced JSON in response: ${text.slice(0, 200)}`);
}

/* ------------------------------------------------------------------ */
/* Offline mode: enough structure to exercise the whole pipeline.      */
/* ------------------------------------------------------------------ */

const MOCK_PROSE = [
  "The room was cold. She put the bag on the table and did not take off her coat.",
  "For a while neither of them spoke. A train passed somewhere below the window.",
  "He asked whether she had eaten. She said that she had, on the train.",
  "The kettle began to make a sound. He got up and turned off the gas.",
  "There were two cups on the shelf. One of them had a chip at the rim.",
  "She looked at the window. It was raining again, the way it had rained the week before.",
  "In any case, it did not matter now. He sat down and put his hands on his knees.",
  "The next morning the snow had stopped. The street was grey and the shops were still closed.",
  "She said she would come back in the afternoon. He said that he would be here.",
  "For a moment she stood in the doorway. Then she went out, and the door closed.",
];

function mockWordCount(messages: Msg[]): number {
  const all = messages.map((m) => m.content).join("\n");
  const m = all.match(/Target length:\s*(\d+)\s*words/i);
  return m ? Number(m[1]) : 700;
}

function mockProse(words: number): string {
  const out: string[] = [];
  let i = 0;
  while (countWords(out.join(" ")) < words) {
    out.push(MOCK_PROSE[i % MOCK_PROSE.length]!);
    i++;
    if (i > 200) break;
  }
  return out.join("\n\n");
}

function mockResponse(opts: ChatOpts): string {
  const tag = opts.tag ?? "chat";
  const all = opts.messages.map((m) => m.content).join("\n");

  if (tag === "plan") {
    const wordsMatch = all.match(/TOTAL_WORDS:\s*(\d+)/);
    const total = wordsMatch ? Number(wordsMatch[1]) : 3000;
    const chapters = Math.max(2, Math.min(8, Math.round(total / 1200)));
    const perChapter = Math.round(total / chapters);
    return JSON.stringify({
      title: "The Inherited Room",
      logline: "A woman returns to her dead sister's apartment and finds the life she did not take.",
      characters: [
        { name: "Mika", role: "protagonist", note: "returns to the apartment" },
        { name: "Sachiko", role: "the dead sister", note: "present through objects" },
        { name: "Ono", role: "neighbour", note: "knows more than he says" },
      ],
      chapters: Array.from({ length: chapters }, (_, idx) => ({
        number: idx + 1,
        title: `Chapter ${idx + 1}`,
        function: idx === 0 ? "arrival" : idx === chapters - 1 ? "departure" : "accumulation",
        targetWords: perChapter,
        scenes: [
          {
            id: `${idx + 1}-1`,
            beat: "She enters the apartment and inventories what is there.",
            targetWords: Math.round(perChapter / 2),
          },
          {
            id: `${idx + 1}-2`,
            beat: "A conversation with Ono that does not reach its subject.",
            targetWords: perChapter - Math.round(perChapter / 2),
          },
        ],
      })),
    });
  }

  if (tag === "bible") {
    return JSON.stringify({
      entities: ["Mika", "Sachiko", "Ono"],
      facts: ["The sister is dead.", "The apartment is empty."],
      threads: ["What happened to the sister's belongings."],
      events: ["Mika arrives at the apartment.", "Ono speaks to her in the corridor."],
    });
  }

  if (tag === "anchors") {
    return [mockProse(170), mockProse(160), mockProse(180)].join("\n\n---\n\n");
  }

  if (tag === "draft") {
    return mockProse(mockWordCount(opts.messages));
  }

  if (tag === "polish" || tag === "expand" || tag === "compress") {
    const draft = opts.messages.map((m) => m.content).join("\n");
    const marker = draft.indexOf("# DRAFT");
    if (marker !== -1) {
      const after = draft.slice(marker + 6).trim();
      const end = after.indexOf("\n# ");
      return (end === -1 ? after : after.slice(0, end)).trim();
    }
    return mockProse(mockWordCount(opts.messages));
  }

  return mockProse(300);
}
