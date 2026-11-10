import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { loadConfig, requireKey, type Config } from "../config.js";
import { countWords } from "../util/text.js";

export type Role = "system" | "user" | "assistant";
export type Msg = { role: Role; content: string };

export type Effort = "low" | "medium" | "high" | "max";

export type ChatOpts = {
  messages: Msg[];
  tier?: "flash" | "pro";
  model?: string;
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  tag?: string;
  effort?: Effort;
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

function projectLogPath(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(dir, ".jpvoice"))) return join(dir, ".jpvoice", "runs.jsonl");
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function log(entry: Record<string, unknown>): void {
  const target = logPath ?? projectLogPath();
  if (!target) return;
  try {
    appendFileSync(target, JSON.stringify(entry) + "\n");
  } catch {
    /* logging must never break a run */
  }
}

function backoff(attempt: number): number {
  return Math.min(20_000, 800 * 2 ** attempt + Math.random() * 400);
}

/**
 * The OpenCode gateway routes and caches per conversation, so it wants a
 * stable id. Deriving it from the working directory gives one session per
 * story project for free.
 */
function sessionId(cfg: Config): string {
  if (process.env.JPVOICE_SESSION) return process.env.JPVOICE_SESSION;
  const digest = createHash("sha256").update(process.cwd()).digest("hex").slice(0, 24);
  return `jpvoice-${digest}`;
}

function gatewayError(status: number, body: string): Error {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; type?: string } };
    if (parsed.error?.message) {
      return new Error(`Model gateway ${status} (${parsed.error.type ?? "error"}): ${parsed.error.message}`);
    }
  } catch {
    /* fall through */
  }
  return new Error(`Model gateway ${status}: ${body.slice(0, 600)}`);
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
  const timeoutMs = Number(process.env.JPVOICE_TIMEOUT_MS ?? 240_000);
  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.9,
    max_tokens: opts.maxTokens ?? cfg.maxTokens,
    stream: false,
  };
  if (opts.json) body.response_format = { type: "json_object" };

  // Reasoning tokens are not bounded by max_tokens on every model, and an
  // unbounded default can turn one scene into a five-minute request.
  if (cfg.provider === "opencode") {
    body.reasoning_effort = opts.effort ?? cfg.effort[tier];
  } else if (process.env.JPVOICE_SEND_EFFORT === "1") {
    body.reasoning_effort = opts.effort ?? cfg.effort[tier];
  }

  if (process.env.JPVOICE_DEBUG_BODY) {
    try {
      writeFileSync(process.env.JPVOICE_DEBUG_BODY, JSON.stringify(body, null, 2), "utf8");
    } catch {
      /* debug only */
    }
  }

  let lastError: Error | null = null;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
    "User-Agent": cfg.userAgent,
  };
  if (cfg.provider === "opencode") {
    headers["x-opencode-session"] = sessionId(cfg);
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      if (process.env.JPVOICE_DEBUG) {
        console.error(
          `[jpvoice] POST ${cfg.baseUrl}/chat/completions model=${model} max_tokens=${String(body.max_tokens)} attempt=${attempt + 1} bytes=${JSON.stringify(body).length}`,
        );
      }
      const startedRequest = Date.now();
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (process.env.JPVOICE_DEBUG) {
        console.error(`[jpvoice] <- ${res.status} in ${Date.now() - startedRequest}ms`);
      }

      if (res.status === 429 || res.status >= 500) {
        const text = await res.text();
        lastError = gatewayError(res.status, text);
        await sleep(backoff(attempt));
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw gatewayError(res.status, text);
      }

      const data = (await res.json()) as {
        choices?: Array<{
          finish_reason?: string;
          message?: { content?: string; reasoning_content?: string };
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          completion_tokens_details?: { reasoning_tokens?: number };
          opencode?: { allowance?: number; billing_source?: string; list_cost?: number };
        };
        error?: { message?: string; type?: string };
      };

      if (data.error?.message) {
        throw new Error(`Model gateway error (${data.error.type ?? "error"}): ${data.error.message}`);
      }

      const text = data.choices?.[0]?.message?.content ?? "";
      const finish = data.choices?.[0]?.finish_reason;
      if (!text.trim() && finish === "length") {
        throw new Error(
          `The model used its entire ${String(body.max_tokens)}-token budget on reasoning and returned no text. Lower reasoning effort (JPVOICE_EFFORT_FLASH=low) or raise max tokens.`,
        );
      }
      const inputTokens = data.usage?.prompt_tokens ?? approxTokens(opts.messages.map((m) => m.content).join("\n"));
      const outputTokens = data.usage?.completion_tokens ?? approxTokens(text);
      const price = cfg.pricing[tier];
      const estimated = (inputTokens / 1e6) * price.in + (outputTokens / 1e6) * price.out;
      // The gateway reports what the request actually cost the plan.
      const allowance = data.usage?.opencode?.allowance;
      const costUsd = typeof allowance === "number" && allowance > 0 ? allowance : estimated;
      sessionCost += costUsd;

      log({
        ts: new Date().toISOString(),
        tag: opts.tag ?? "chat",
        model,
        tier,
        provider: cfg.provider,
        inputTokens,
        outputTokens,
        reasoningTokens: data.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
        costUsd,
        billing: data.usage?.opencode?.billing_source ?? "unknown",
        peak: cfg.peak,
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
      if (lastError.name === "TimeoutError" || /aborted/i.test(lastError.message)) {
        lastError = new Error(
          `Request exceeded ${Math.round(timeoutMs / 1000)}s. Lower the scene budget, raise JPVOICE_TIMEOUT_MS, or switch the pass to a faster model.`,
        );
      }
      if (attempt === 3) break;
      await sleep(backoff(attempt));
    }
  }

  throw lastError ?? new Error("Model request failed");
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
