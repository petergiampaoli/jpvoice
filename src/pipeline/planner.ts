import { chat, extractJson } from "../llm/client.js";
import type { EffectiveVoice } from "../voice/schema.js";
import { renderVoiceSpec } from "../voice/render.js";
import {
  reconcilePlan,
  structureFor,
  type StoryPlan,
  type Structure,
} from "./budget.js";

export type PlanInput = {
  premise: string;
  words: number;
  voice: EffectiveVoice;
  title?: string;
};

const PLAN_SYSTEM = `You are a story architect working inside a specific prose register. You design structure only; you do not write prose.

You must produce a beat sheet that can be dramatised scene by scene. Beats are concrete actions, not themes. A beat says what happens and what changes. Never write "she reflects on her grief"; write "she opens the wardrobe and finds a coat that is not hers."

Rules:
- Every scene must contain an event, not only an interior state.
- Dialogue-heavy scenes and silent scenes must alternate.
- Do not resolve the story. End on an object, a fact, or a departure.
- No character explains the theme.
- The last scene must not contain a revelation, a confession, or a moral.

Return JSON only, matching this shape:
{
  "title": string,
  "logline": string,
  "characters": [{"name": string, "role": string, "note": string}],
  "chapters": [
    {
      "number": number,
      "title": string,
      "function": string,
      "scenes": [{"beat": string}]
    }
  ]
}`;

export async function planStory(input: PlanInput): Promise<{ plan: StoryPlan; structure: Structure; raw: string }> {
  const structure = structureFor(input.words, input.voice.form);

  const skeleton = structure.chapters
    .map(
      (c) =>
        `Chapter ${c.number}: ${c.sceneCount} scene(s), ${c.budgets.join(" + ")} words`,
    )
    .join("\n");

  const user = [
    `PREMISE: ${input.premise}`,
    input.title ? `WORKING TITLE: ${input.title}` : "",
    `TOTAL_WORDS: ${input.words}`,
    `FORM: ${input.voice.form.label}`,
    `POV: ${input.voice.pov}. TENSE: ${input.voice.tense}.`,
    ``,
    `REQUIRED STRUCTURE — return exactly this many chapters and scenes, in this order:`,
    skeleton,
    ``,
    `Total scenes: ${structure.totalScenes}.`,
    ``,
    `## Register constraints that affect structure`,
    renderVoiceSpec(input.voice).split("\n").slice(0, 40).join("\n"),
    ``,
    `Write beats that fit this structure exactly. Do not add or remove scenes.`,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await chat({
    messages: [
      { role: "system", content: PLAN_SYSTEM },
      { role: "user", content: user },
    ],
    tier: "pro",
    temperature: 0.8,
    json: true,
    tag: "plan",
  });

  let parsed: StoryPlan;
  try {
    parsed = extractJson<StoryPlan>(res.text);
  } catch {
    parsed = {
      title: input.title || "Untitled",
      logline: "",
      characters: [],
      chapters: structure.chapters.map((c) => ({
        number: c.number,
        title: `Chapter ${c.number}`,
        function: "accumulation",
        targetWords: c.budgets.reduce((a, b) => a + b, 0),
        scenes: c.budgets.map((b, i) => ({
          id: `${c.number}-${i + 1}`,
          beat: `Continue from the previous scene. Target ${b} words.`,
          targetWords: b,
        })),
      })),
    };
  }

  const plan = reconcilePlan(parsed, structure, input.title || "Untitled");
  return { plan, structure, raw: res.text };
}
