import type { Band } from "../metrics/stylometry.js";
import { uniq } from "../util/text.js";
import type {
  ChorusInfo,
  EffectiveVoice,
  FormSpec,
  Targets,
} from "./schema.js";

/**
 * Below this weight a member is a guest, not a full member. Guests contribute
 * named moves and vocabulary; they do not move the numeric targets. Without
 * this split, a 10% member still drags the mean sentence length toward its own,
 * and two distinctive voices average into a bland middle.
 */
export const GUEST_THRESHOLD = 0.15;

function round(n: number, places = 3): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function pct(w: number): string {
  return `${Math.round(w * 100)}%`;
}

export function blendVoices(
  parts: Array<{ voice: EffectiveVoice; weight: number }>,
  opts: {
    form: FormSpec;
    pov?: EffectiveVoice["pov"];
    tense?: EffectiveVoice["tense"];
    label?: string;
  },
): EffectiveVoice {
  if (parts.length < 2) throw new Error("A blend needs at least two voices.");

  const total = parts.reduce((s, p) => s + p.weight, 0);
  if (total <= 0) throw new Error("Blend weights must sum to more than zero.");

  const members = parts
    .map((p) => ({ ...p, weight: p.weight / total }))
    .sort((a, b) => b.weight - a.weight);

  const dominant = members[0]!;
  const full = members.filter((p) => p.weight >= GUEST_THRESHOLD);
  const guests = members.filter((p) => p.weight < GUEST_THRESHOLD);

  /* --- numeric targets: weighted centre and weighted half-width --- */
  const keys = new Set<string>();
  for (const p of full) for (const k of Object.keys(p.voice.targets)) keys.add(k);

  const targets: Targets = {};
  for (const key of keys) {
    const withBand = full.filter((p) => {
      const b = (p.voice.targets as Record<string, unknown>)[key];
      return Array.isArray(b);
    });
    const weightSum = withBand.reduce((s, p) => s + p.weight, 0);
    if (weightSum === 0) continue;

    let centre = 0;
    let half = 0;
    for (const p of withBand) {
      const b = (p.voice.targets as Record<string, Band>)[key]!;
      centre += p.weight * ((b[0] + b[1]) / 2);
      half += p.weight * ((b[1] - b[0]) / 2);
    }
    centre /= weightSum;
    half /= weightSum;

    (targets as Record<string, Band>)[key] = [
      round(Math.max(0, centre - half)),
      round(centre + half),
    ];
  }

  /* --- bans union, always --- */
  const banned = uniq(members.flatMap((p) => p.voice.lexicon.banned));

  /* --- preferred lexicon, scored by summed weight --- */
  const preferScore = new Map<string, number>();
  for (const p of members) {
    for (const term of p.voice.lexicon.prefer) {
      preferScore.set(term, (preferScore.get(term) ?? 0) + p.weight);
    }
  }
  const prefer = [...preferScore.entries()]
    .filter(([term, score]) => score >= 0.34 || dominant.voice.lexicon.prefer.includes(term))
    .filter(([term]) => !banned.some((b) => term.toLowerCase().includes(b.toLowerCase())))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 32)
    .map(([term]) => term);

  /* --- avoid: dominant plus any co-equal member, minus strong preferences --- */
  const avoidSet = new Set(dominant.voice.lexicon.avoid);
  for (const p of members) {
    if (p.weight >= 0.5) for (const term of p.voice.lexicon.avoid) avoidSet.add(term);
  }
  const avoid = [...avoidSet].filter((term) => !prefer.includes(term));

  /* --- tic ceilings scale with membership --- */
  const ticMap = new Map<string, number>();
  for (const p of members) {
    for (const tic of p.voice.tics) {
      ticMap.set(tic.phrase, (ticMap.get(tic.phrase) ?? 0) + p.weight * tic.per1kMax);
    }
  }
  const tics = [...ticMap.entries()]
    .filter(([, v]) => v >= 0.4)
    .map(([phrase, v]) => ({ phrase, per1kMax: round(v, 2) }))
    .sort((a, b) => a.phrase.localeCompare(b.phrase));

  /* --- directives: dominant syntax, weighted imagery, named guest moves --- */
  const imageField = uniq([
    ...dominant.voice.author.poetics.image_field,
    ...full.flatMap((p) => p.voice.author.poetics.image_field),
  ]).slice(0, 14);

  const imageDirective = `Image field: ${imageField.join(", ")}. Draw from these materials. Do not decorate with imported imagery.`;
  const directives = dominant.voice.directives.map((d) =>
    d.startsWith("Image field:") ? imageDirective : d,
  );

  directives.push(
    `Chorus: ${members.map((p) => `${p.voice.key} at ${pct(p.weight)}`).join(", ")}. The dominant voice supplies syntax and structure. The others supply vocabulary and moves only.`,
  );

  for (const p of full.slice(1)) {
    directives.push(
      `Secondary inflection from ${p.voice.key} at ${pct(p.weight)}: visible in vocabulary, subjects, and objects, never in sentence rhythm.`,
    );
  }

  for (const g of guests) {
    const terms = uniq(g.voice.author.poetics.image_field).slice(0, 3);
    if (terms.length === 0) continue;
    directives.push(
      `Guest move from ${g.voice.author.display} at ${pct(g.weight)}: ${terms.join(", ")} may appear where the scene calls for them. Do not let this alter sentence rhythm or length.`,
    );
  }

  /* --- exemplars: dominant plus one from each other member --- */
  const exemplars = [...dominant.voice.exemplars];
  for (const p of members.slice(1)) {
    const ex = p.voice.exemplars[0];
    if (!ex) continue;
    const tag = p.weight >= GUEST_THRESHOLD ? `${p.voice.key} inflection` : `${p.voice.author.display} guest move`;
    exemplars.push({ ...ex, note: `${tag} — ${ex.note ?? ""}`.replace(/ — $/, "") });
  }

  const chorus: ChorusInfo = {
    mode: "blend",
    members: members.map((p) => ({
      key: p.voice.key,
      label: p.voice.label,
      weight: round(p.weight, 3),
      role: p === dominant ? "dominant" : p.weight >= GUEST_THRESHOLD ? "secondary" : "guest",
    })),
  };

  return {
    key: `blend:${members.map((p) => `${p.voice.key}@${pct(p.weight)}`).join("+")}`,
    label:
      opts.label ??
      `Blend — ${members.map((p) => `${p.voice.key} ${pct(p.weight)}`).join(" · ")}`,
    status: "constructed",
    author: dominant.voice.author,
    translator: dominant.voice.translator,
    form: opts.form,
    pov: opts.pov ?? dominant.voice.pov,
    tense: opts.tense ?? dominant.voice.tense,
    targets,
    lexicon: { prefer, avoid, banned },
    tics,
    dialogue: dominant.voice.dialogue,
    exemplars,
    directives,
    chorus,
  };
}
