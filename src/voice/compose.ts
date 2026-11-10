import type { Band } from "../metrics/stylometry.js";
import { uniq } from "../util/text.js";
import { findAuthor, findForm, findTranslator, loadPairings } from "./load.js";
import type { EffectiveVoice, PairingStatus, Targets } from "./schema.js";

function shiftBand(band: Band | undefined, delta: number): Band | undefined {
  if (!band || delta === 0) return band;
  return [Math.max(0, band[0] + delta), Math.max(0, band[1] + delta)];
}

export function parseVoiceKey(key: string): { author: string; translator: string } {
  const [author, translator] = key.split("/");
  if (!author || !translator) {
    throw new Error(`Voice must be written author/translator, e.g. kawabata/seidensticker (got "${key}")`);
  }
  return { author, translator };
}

export function composeVoice(opts: {
  key: string;
  form?: string;
  pov?: EffectiveVoice["pov"];
  tense?: EffectiveVoice["tense"];
}): EffectiveVoice {
  const { author: authorId, translator: translatorId } = parseVoiceKey(opts.key);
  const author = findAuthor(authorId);
  const translator = findTranslator(translatorId);
  const form = findForm(opts.form ?? "short");

  const pairings = loadPairings();
  const status: PairingStatus =
    pairings.get(`${author.id}/${translator.id}`.toLowerCase()) ?? "synthetic";

  const targets: Targets = { ...translator.targets, ...author.targets };
  targets.shortSentenceRatio = shiftBand(targets.shortSentenceRatio, form.shortSentenceShift);
  targets.dialogueRatio = shiftBand(targets.dialogueRatio, form.dialogueRatioShift);

  const pov = opts.pov ?? author.poetics.pov_default;
  const tense = opts.tense ?? author.poetics.tense_default;

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

export function formForWords(words: number): string {
  if (words <= 1200) return "flash";
  if (words <= 6000) return "short";
  if (words <= 45000) return "novella";
  return "novel";
}
