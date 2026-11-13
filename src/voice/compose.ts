import type { Band } from "../metrics/stylometry.js";
import { uniq } from "../util/text.js";
import {
  canonicalTranslatorFor,
  findAuthor,
  findEnsemble,
  findForm,
  findTranslator,
  loadEnsembles,
  loadHouse,
  loadPairings,
} from "./load.js";
import type {
  AuthorSpec,
  ChorusMember,
  EffectiveVoice,
  FormSpec,
  PairingStatus,
  Targets,
  TranslatorSpec,
} from "./schema.js";
import { blendVoices } from "./blend.js";

export type Pov = EffectiveVoice["pov"];
export type Tense = EffectiveVoice["tense"];

export type VoiceRequest =
  | { kind: "single"; key: string }
  | { kind: "house" }
  | { kind: "ensemble"; id: string }
  | { kind: "blend"; members: Array<{ key: string; weight: number }> };

function shiftBand(band: Band | undefined, delta: number): Band | undefined {
  if (!band || delta === 0) return band;
  return [Math.max(0, band[0] + delta), Math.max(0, band[1] + delta)];
}

export function parseVoiceRequest(spec: string): VoiceRequest {
  const trimmed = spec.trim();
  if (!trimmed) return { kind: "house" };
  const lower = trimmed.toLowerCase();
  if (lower === "house" || lower === "house/house") return { kind: "house" };

  if (trimmed.includes(",")) {
    const members = trimmed.split(",").map((part) => {
      const [keyPart, weightPart] = part.split(":");
      const key = (keyPart ?? "").trim();
      if (!key) throw new Error(`Empty voice in chorus: "${spec}"`);
      const weight = weightPart === undefined ? 1 : Number(weightPart);
      if (!Number.isFinite(weight) || weight <= 0) {
        throw new Error(`Bad chorus weight "${weightPart}" for ${key}`);
      }
      return { key, weight };
    });
    if (members.length < 2) throw new Error("A chorus needs at least two voices, separated by commas.");
    return { kind: "blend", members };
  }

  if (!trimmed.includes("/")) {
    if (loadEnsembles().some((e) => e.id.toLowerCase() === lower)) {
      return { kind: "ensemble", id: trimmed };
    }
    return { kind: "single", key: trimmed };
  }

  return { kind: "single", key: trimmed };
}

function resolvePair(key: string): { authorId: string; translatorId: string } {
  if (key.includes("/")) {
    const [authorId, translatorId] = key.split("/");
    if (!authorId || !translatorId) {
      throw new Error(`Voice must be written author/translator, e.g. kawabata/seidensticker (got "${key}")`);
    }
    return { authorId, translatorId };
  }
  const author = findAuthor(key);
  const translatorId = canonicalTranslatorFor(author.id);
  if (!translatorId) {
    throw new Error(`No canonical translator for "${author.id}". Write ${author.id}/<translator>.`);
  }
  return { authorId: author.id, translatorId };
}

/** Shared assembly: both single voices and the house register use this path. */
function assemble(args: {
  author: AuthorSpec;
  translator: TranslatorSpec;
  form: FormSpec;
  status: PairingStatus;
  pov?: Pov;
  tense?: Tense;
}): EffectiveVoice {
  const { author, translator, form, status } = args;

  const targets: Targets = { ...translator.targets, ...author.targets };
  targets.shortSentenceRatio = shiftBand(targets.shortSentenceRatio, form.shortSentenceShift);
  targets.dialogueRatio = shiftBand(targets.dialogueRatio, form.dialogueRatioShift);

  const pov = args.pov ?? author.poetics.pov_default;
  const tense = args.tense ?? author.poetics.tense_default;
  const directives: string[] = [];

  directives.push(
    `Image field: ${author.poetics.image_field.join(", ")}. Draw from these materials. Do not decorate with imported imagery.`,
  );
  if (author.poetics.structure) directives.push(`Structure: ${author.poetics.structure}`);
  directives.push(`Interiority: ${author.poetics.interiority}. Endings: ${author.poetics.endings}.`);
  if (author.poetics.forbidden.length) {
    directives.push(`Forbidden in this voice: ${author.poetics.forbidden.join("; ")}.`);
  }

  const s = translator.syntax;
  directives.push(
    s.subject_repetition === "high"
      ? "Repeat the character's name rather than varying it with epithets or falling back on pronouns. This repetition is the voice, not a defect."
      : "Vary reference only slightly; keep naming plain.",
  );
  directives.push(
    s.parataxis === "high"
      ? "Join clauses with 'and', a comma, or nothing. Keep subordination shallow. Prefer two short sentences to one long one."
      : "Longer sentences are permitted, but keep them left-branching and unadorned.",
  );
  directives.push(`Fragments: ${s.fragments}.`);
  if (s.pronoun_variation === "low") {
    directives.push("Do not reach for synonym variation. Plain repetition is correct here.");
  }
  if (s.sentence_openings.length) {
    directives.push(`Open sentences with: ${s.sentence_openings.join(", ")}.`);
  }
  for (const note of s.notes) directives.push(note);
  for (const note of translator.punctuation.notes) directives.push(note);

  directives.push(
    "Never name an emotion in narration. Render it as a body, a gesture, weather, an object, or a flat statement after the fact.",
    "Do not explain an image after presenting it. State it and move on.",
    "No rhetorical crescendo. The most important sentence should be as flat as the ones around it.",
    "Anchor time explicitly: 'The next morning.' 'At two o'clock.' 'For a while.'",
    "When in doubt, delete the sentence.",
  );

  if (pov === "first") {
    directives.push(
      "First person, retrospective. The narrator reports; he or she does not perform. No present-tense pyrotechnics.",
    );
  }
  if (tense === "past") {
    directives.push("Simple past throughout. Avoid the perfect aspect unless the sequence requires it.");
  }

  return {
    key: `${author.id}/${translator.id}`,
    label: `${author.display}, in the English of ${translator.display}`,
    status,
    author,
    translator,
    form,
    pov,
    tense,
    targets,
    lexicon: {
      prefer: uniq([...author.lexicon.prefer, ...translator.lexicon.prefer]),
      avoid: uniq([...author.lexicon.avoid, ...translator.lexicon.avoid]),
      banned: uniq([...translator.lexicon.banned_idioms]),
    },
    tics: translator.tics,
    dialogue: translator.dialogue,
    exemplars: translator.exemplars,
    directives,
  };
}

function composeSingle(key: string, form: string, pov?: Pov, tense?: Tense): EffectiveVoice {
  const { authorId, translatorId } = resolvePair(key);
  const author = findAuthor(authorId);
  const translator = findTranslator(translatorId);

  const pairings = loadPairings();
  const status: PairingStatus =
    pairings.get(`${author.id}/${translator.id}`.toLowerCase()) ?? "synthetic";

  return assemble({
    author,
    translator,
    form: findForm(form),
    status,
    pov,
    tense,
  });
}

function composeHouse(form: string, pov?: Pov, tense?: Tense): EffectiveVoice {
  const house = loadHouse();

  const author = {
    id: house.id,
    kind: "author",
    display: house.display,
    tradition: "consensus register",
    summary: house.summary,
    poetics: house.poetics,
    lexicon: { prefer: house.lexicon.prefer, avoid: house.lexicon.avoid },
    targets: {
      dialogueRatio: house.targets.dialogueRatio,
      concretePer1k: house.targets.concretePer1k,
    },
  } as AuthorSpec;

  const translator = {
    id: house.id,
    kind: "translator",
    display: "the house translator",
    archetype: "consensus",
    register: house.summary,
    syntax: house.syntax,
    targets: house.targets,
    lexicon: {
      prefer: house.lexicon.prefer,
      avoid: house.lexicon.avoid,
      banned_idioms: house.lexicon.banned_idioms,
    },
    punctuation: house.punctuation,
    tics: house.tics,
    dialogue: house.dialogue,
    exemplars: house.exemplars,
  } as TranslatorSpec;

  const voice = assemble({
    author,
    translator,
    form: findForm(form),
    status: "constructed",
    pov,
    tense,
  });
  voice.key = "house";
  voice.label = "House register — translated-Japanese consensus";
  return voice;
}

export function composeVoice(opts: {
  key: string;
  form?: string;
  pov?: Pov;
  tense?: Tense;
}): EffectiveVoice {
  const form = opts.form ?? "short";
  const request = parseVoiceRequest(opts.key);

  switch (request.kind) {
    case "house":
      return composeHouse(form, opts.pov, opts.tense);

    case "single":
      return composeSingle(request.key, form, opts.pov, opts.tense);

    case "ensemble": {
      const ensemble = findEnsemble(request.id);
      const parts = ensemble.members.map((m) => ({
        voice: composeMember(m.voice, form),
        weight: m.weight,
      }));
      return blendVoices(parts, { form: findForm(form), pov: opts.pov, tense: opts.tense, label: ensemble.label });
    }

    case "blend": {
      const parts = request.members.map((m) => {
        if (loadEnsembles().some((e) => e.id.toLowerCase() === m.key.toLowerCase())) {
          throw new Error(`Nested ensembles are not supported ("${m.key}"). List its voices directly.`);
        }
        return { voice: composeMember(m.key, form), weight: m.weight };
      });
      return blendVoices(parts, { form: findForm(form), pov: opts.pov, tense: opts.tense });
    }
  }
}

function composeMember(key: string, form: string): EffectiveVoice {
  const request = parseVoiceRequest(key);
  if (request.kind === "house") return composeHouse(form);
  if (request.kind !== "single") {
    throw new Error(`Chorus members must be a single voice or the house register (got "${key}").`);
  }
  return composeSingle(request.key, form);
}

export function formForWords(words: number): string {
  if (words <= 1200) return "flash";
  if (words <= 6000) return "short";
  if (words <= 45000) return "novella";
  return "novel";
}

/** Kept for callers that only have a full author/translator string. */
export function parseVoiceKey(key: string): { author: string; translator: string } {
  const { authorId, translatorId } = resolvePair(key);
  return { author: authorId, translator: translatorId };
}

export type { ChorusMember };
