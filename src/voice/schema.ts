import { z } from "zod";
import type { Band, MetricKey } from "../metrics/stylometry.js";

export const BandSchema = z.tuple([z.number(), z.number()]);
export const TargetsSchema = z.record(z.string(), BandSchema);

export type Targets = Partial<Record<MetricKey, Band>>;

export const AuthorSpecSchema = z
  .object({
    id: z.string(),
    kind: z.literal("author"),
    display: z.string(),
    life: z.string().optional(),
    tradition: z.string().optional(),
    summary: z.string(),
    poetics: z
      .object({
        image_field: z.array(z.string()).default([]),
        motifs: z.array(z.string()).default([]),
        structure: z.string().default(""),
        pov_default: z.enum(["first", "third-limited", "third-omniscient"]).default("third-limited"),
        tense_default: z.enum(["past", "present"]).default("past"),
        interiority: z.string().default("sparse"),
        endings: z.string().default("unresolved"),
        forbidden: z.array(z.string()).default([]),
      })
      .passthrough(),
    lexicon: z
      .object({
        prefer: z.array(z.string()).default([]),
        avoid: z.array(z.string()).default([]),
      })
      .default({ prefer: [], avoid: [] }),
    targets: TargetsSchema.default({}),
  })
  .passthrough();

export const TranslatorSpecSchema = z
  .object({
    id: z.string(),
    kind: z.literal("translator"),
    display: z.string(),
    archetype: z.string(),
    register: z.string(),
    syntax: z
      .object({
        parataxis: z.enum(["high", "medium", "low"]).default("high"),
        subordination: z.enum(["high", "medium", "low"]).default("low"),
        subject_repetition: z.enum(["high", "medium", "low"]).default("high"),
        pronoun_variation: z.enum(["high", "medium", "low"]).default("low"),
        fragments: z.string().default("allowed for image and weather"),
        sentence_openings: z.array(z.string()).default([]),
        notes: z.array(z.string()).default([]),
      })
      .passthrough(),
    targets: TargetsSchema.default({}),
    lexicon: z
      .object({
        prefer: z.array(z.string()).default([]),
        avoid: z.array(z.string()).default([]),
        banned_idioms: z.array(z.string()).default([]),
      })
      .default({ prefer: [], avoid: [], banned_idioms: [] }),
    punctuation: z
      .object({
        italics_emphasis: z.boolean().default(false),
        notes: z.array(z.string()).default([]),
      })
      .passthrough()
      .default({ italics_emphasis: false, notes: [] }),
    tics: z
      .array(z.object({ phrase: z.string(), per1kMax: z.number() }))
      .default([]),
    dialogue: z
      .object({
        tags: z.array(z.string()).default(["said"]),
        tag_variety: z.enum(["none", "low", "medium"]).default("none"),
        honorifics: z.string().default("preserve"),
        particles: z.string().default("trailing ellipsis, minimal"),
      })
      .passthrough()
      .default({ tags: ["said"], tag_variety: "none", honorifics: "preserve", particles: "trailing ellipsis, minimal" }),
    exemplars: z
      .array(z.object({ before: z.string(), after: z.string(), note: z.string().optional() }))
      .default([]),
  })
  .passthrough();

export const FormSpecSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    words: z.tuple([z.number(), z.number()]),
    sceneCap: z.number(),
    wordsPerScene: z.tuple([z.number(), z.number()]),
    dialogueRatioShift: z.number().default(0),
    shortSentenceShift: z.number().default(0),
    interiority: z.string().default("minimal"),
    notes: z.string().default(""),
  })
  .passthrough();

export type AuthorSpec = z.infer<typeof AuthorSpecSchema>;
export type TranslatorSpec = z.infer<typeof TranslatorSpecSchema>;
export type FormSpec = z.infer<typeof FormSpecSchema>;

export type PairingStatus = "canonical" | "synthetic";

export type EffectiveVoice = {
  key: string;
  label: string;
  status: PairingStatus;
  author: AuthorSpec;
  translator: TranslatorSpec;
  form: FormSpec;
  pov: "first" | "third-limited" | "third-omniscient";
  tense: "past" | "present";
  targets: Targets;
  lexicon: { prefer: string[]; avoid: string[]; banned: string[] };
  tics: Array<{ phrase: string; per1kMax: number }>;
  dialogue: TranslatorSpec["dialogue"];
  exemplars: TranslatorSpec["exemplars"];
  directives: string[];
};
