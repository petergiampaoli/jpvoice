# jpvoice

A story builder whose voice is the translated-Japanese register: post-war Japanese fiction as it reaches English through a translator.

It writes from a premise, and it re-voices text you already have. It holds a register for 30,000 words, not three paragraphs, because the voice is specified, measured, and corrected rather than described in a prompt.

```
  metric              native English    translated    target
  --------------------------------------------------------------------
  mean sentence       11.09             9.93                11–17
  short (≤8w)         36%               37%                 34–54%
  similes /1k         8.2               0                   0–4
  em dashes /1k       12.3              3.73                0–1.5
  register breakers   10                0                   0
  --------------------------------------------------------------------
  conformance         0/100             81/100
```

## The idea

The register you hear is not a national mood. It is a **translator's idiolect** — a set of mechanical habits produced by moving Japanese into English. That makes it specifiable:

1. **Subject repetition, low pronoun variation.** Japanese drops subjects; translators reinsert them, and reinsert the name rather than reaching for elegant English variation. "Kikuko stood. Kikuko said nothing." Native-English craft advice tells you never to do this. It is the single most identifiable fingerprint.
2. **Parataxis and the "and" chain.** The て-form sequences clauses, so English arrives as short declaratives joined by *and*, a comma, or nothing.
3. **Retained perception verbs.** "His eyes followed her." "The sound reached his ears." English craft says cut these; the register keeps them, and keeps body parts as grammatical agents.
4. **Epistemic hedging residue.** だろう / かもしれない / ようだ / なんとなく surface as *perhaps, probably, somehow, it seemed, for no particular reason*.
5. **Emotion named flatly or not at all.** "I felt a little sad," after the fact, without crescendo — or displaced into weather, food, hands, objects.
6. **Explicit time anchors and object inventory.** "The next morning." "At two o'clock." Trains, cigarettes, receipts, weather. The world is catalogued, not symbolised.
7. **Punctuation diet.** Few em-dashes, no italics for emphasis, rare exclamation marks, heavy ellipsis as rendered 間.
8. **Politeness residue in dialogue.** "Is that so?" "I see." "I'm sorry." Minimal tags, overwhelmingly *said*.
9. **Repetition as device.** Anaphora reads as incantation, not as a failure of vocabulary.

`jpvoice` encodes these as a **voice contract**, measures a draft against it, and iterates until the draft is inside the bands.

## Install

```bash
cd jpvoice
npm install
npm run build
npm link            # optional: puts `jpvoice` on PATH
jpvoice doctor
```

`jpvoice` uses your existing **OpenCode Go** credentials automatically. It reads `~/.local/share/opencode/auth.json` (or `OPENCODE_API_KEY`), calls `https://opencode.ai/inference/go/openai/v1`, sends a stable `x-opencode-session` per project, and identifies itself as `jpvoice/0.1.0`. Nothing needs to be copied into `.env`.

To use DeepSeek directly instead:

```bash
export JPVOICE_PROVIDER=deepseek
export DEEPSEEK_API_KEY=sk-...
```

Options live in `.env.example`. No key at all? `JPVOICE_MOCK=1` runs the whole pipeline offline with deterministic canned prose.

> **A note on the gateway.** OpenCode Go is documented as a coding-agent endpoint, and traffic is monitored for use that degrades it for others. Story generation is not coding traffic. For occasional use it is fine; for a 40,000-word novella, point `JPVOICE_PROVIDER=deepseek` at your own DeepSeek key instead. The client is OpenAI-compatible either way.

### Cost and model routing

Reasoning tokens are not bounded by `max_tokens` on every model. Left at defaults, one Pro call generated **21,759 reasoning tokens** — four and a half minutes and $0.18 for three short paragraphs. So each pass pins `reasoning_effort`, and the default is `none` for prose passes:

| Pass | Tier | Effort | Measured |
|---|---|---|---|
| Plan | Pro | low | 12–32s · $0.013–0.030 |
| Anchors | Flash | none | 48–97s · $0.00025 for 3 passages |
| Draft | Flash | none | 1,457 words in 20s · $0.0006 |
| Polish | Flash | none | 82→85 conformance in 26s · $0.002 |
| Expand | Flash | none | 1,457→1,827 words in 8s · $0.0005 |

A 1,600-word story costs about **$0.024** end to end. Pro is available for polish with `JPVOICE_TIER_POLISH=pro`, but in the A/B it was 25× the cost and scored no better on line editing. Reasoning effort is advisory, not a hard cap: the same prompt at `low` produced 595 reasoning tokens on one run and 11,181 on another. `none` is the only setting that behaves predictably.

## Quickstart

```bash
jpvoice voices list
jpvoice init "The Inherited Room" \
  --voice kawabata/seidensticker \
  --words 3000 \
  --premise "A woman returns to her dead sister's apartment and finds the life she did not take." \
  --path work/inherited-room

jpvoice --dir work/inherited-room plan
jpvoice --dir work/inherited-room anchors     # review the frozen register samples
jpvoice --dir work/inherited-room draft
jpvoice --dir work/inherited-room polish
jpvoice --dir work/inherited-room audit
```

Output lives in `work/inherited-room/`:

```
manuscript.md
.jpvoice/
  project.json      plan, budgets, scene state, bible
  anchors.md        frozen voice anchors
  scenes/*.md       one file per scene
  reports/          audit reports
  runs.jsonl        every model call, tokens, cost
```

## The voice library

Nine authors × thirteen translators = 117 composable voices, from 23 spec files. Composition is what makes this tractable: the **author layer** controls imagery, motifs, structure and POV; the **translator layer** controls syntax, lexicon, punctuation and dialogue rendering. The translator wins on texture, the author wins on material.

| Authors | |
|---|---|
| Kawabata · Mishima · Tanizaki · Dazai · Abe · Ōe · Murakami · Murata · Kawakami | |

| Translators | Register |
|---|---|
| Seidensticker, Emmerich | lyric-formal · literal-lyric |
| Keene, Bester | formal-latinate · formal-periodic |
| McCarthy, Carpenter | clean-contemporary · plain-transparent |
| Saunders | clinical-procedural |
| Nathan | urgent-appositive |
| Birnbaum, Rubin, Gabriel | hardboiled-cool · transparent-plain · smooth-lyric |
| Takemori, Bett & Boyd | bright-flat · precise-cool |

Seventeen pairings are **canonical** — that translator actually translated that author. Everything else is labelled `synthetic` in every prompt, score output, and report. A synthetic voice is an extrapolation, and says so.

```bash
jpvoice voices kawabata/seidensticker
jpvoice voices murakami/keene --form novella   # synthetic, flagged
jpvoice voices kawabata                        # bare author → canonical translator
```

### `--voice` is optional

Leave it off and you get the **house register**: a hand-written consensus of the mechanisms with every signature removed. Not an average — averaging thirteen translators produces mush. The house spec is `voices/house.yaml`, status `constructed`, and it never claims to be a historical translation.

```bash
jpvoice init "Title" --words 2000        # house register
jpvoice score draft.md                   # labels itself "house register (generic)"
```

`score` says so out loud, because scoring against the house bands is a looser read than scoring against a named voice.

## Choruses

Blend voices into one register by weighting them:

```bash
jpvoice init "Title" --voice "kawabata/seidensticker:60, abe/saunders:30, dazai/keene:10"
```

Or keep the blend as a file in `voices/ensembles/`, then refer to it by name:

```yaml
id: provincial-gothic
kind: ensemble
mode: blend
members:
  - { voice: kawabata/seidensticker, weight: 60 }
  - { voice: abe/saunders,          weight: 30 }
  - { voice: dazai/keene,           weight: 10 }
```

```bash
jpvoice voices provincial-gothic
```

```bash
jpvoice init "Title" --voice provincial-gothic
```

**How the merge works.** Numeric bands are combined by weighted centre and weighted half-width. Banned phrases are **unioned** — a chorus never permits what one member forbids. Tic ceilings are unioned but scaled by each member's weight. The dominant member supplies syntax, POV, tense, and dialogue rendering; everyone else contributes vocabulary, objects, and exemplars.

**The 15% rule.** A member below 15% is a *guest*, not a full member. Guests contribute named moves and up to three image terms; they do not move the numeric targets. Without that split, a 10% member still drags sentence length toward its own, and two distinctive voices average into a bland middle.

Blends are deterministic and labelled `constructed`. `jpvoice voices <name>` prints the full provenance:

```
Chorus: blend of 3 voices
- kawabata/seidensticker 60% (dominant)
- abe/saunders 30% (secondary)
- dazai/keene 10% (guest)
```

**Prefer 70/30 over 50/50.** Equal weights are the weakest setting: the average of two strong voices is not a third voice, it is a washed-out middle.

## Word count is a control loop

A number in a prompt produces ±40% error. So `--words` never reaches the model directly. It is allocated:

```
target → structure → scene budgets → measure → expand/compress → re-measure
```

| Target | Chapters | Scenes | ~Words/scene |
|---|---|---|---|
| 1,000 | 1 | 1 | 1,000 |
| 5,000 | 3 | 5 | 1,000 |
| 15,000 | 8 | 16 | 940 |
| 30,000 | 14 | 26 | 1,150 |
| 40,000 | 18 | 32 | 1,250 |

The last column barely moves. **Scale by adding scenes, not by lengthening them.** Scenes past ~1,600 words sag in register, so the planner is forbidden from exceeding the cap.

Expansion draws from a closed menu of voice-legal moves — quotidian procedure, explicit time intervals, object inventory, one more exchange of dialogue, weather, gesture, sentence splitting — never adjectives, similes, or explanatory interiority.

```bash
jpvoice scale draft.md --to 12000 --voice kawabata/seidensticker
jpvoice scale draft.md --to 4000  --voice kawabata/seidensticker
```

## Measurement

`jpvoice score` computes 20 metrics: sentence-length distribution, short/long shares, name-to-pronoun ratio, hedge density, filter-verb density, abstraction ratio, simile rate, adverb rate, dialogue share, punctuation rates, paragraph length, tic counts, and register breakers.

The **critic loop** (`polish`) runs conformance, emits targeted fixes one issue class at a time, revises, and re-measures — up to three rounds. It refuses revisions that gut or inflate a scene by more than 35%.

Two constraints keep it from becoming parody:

- **Tic ceilings.** `"for a while"` at most 1.6 per 1,000 words. Over-applied style reads as fake, not strong.
- **Register breakers.** Thirty-five phrases that almost never survive translation — *a wave of*, *in that moment*, *heart pounded*, *voice barely above a whisper*, *she found herself*. One occurrence is a hard failure.

Rate metrics are unreliable on short passages, so a single em dash in 200 words is not reported as a crisis. Severity is scaled by the number of occurrences, not the raw rate.

## Holding the voice over 30,000 words

Two mechanisms.

**Frozen anchors.** Generate 3–5 passages in the target register, approve them, freeze them. Two are re-injected into every subsequent scene. They are self-generated, so no copyrighted text is involved, and they fix cadence in a way prose description cannot.

**The drift curve.** `jpvoice audit` plots mean conformance per chapter and reports first-to-last change in sentence length, name-to-pronoun ratio, and hedge density. Voice decay shows up in the numbers before it shows up in your reading.

```bash
jpvoice audit
```

```
  drift curve
  ch  1  ████████████████████████  92  1980/2000 words
  ch  2  ██████████████████████··  88  2040/2000 words
  ch  3  ████████████████████····  81  1900/2000 words
```

## Re-voicing existing text

Never one-shot. The sequence is:

1. **Extract a story bible** — entities, facts, events, threads.
2. **Lock it.** The bible is the only invariant.
3. **Segment** into ~1,200-word chunks.
4. **Rewrite** each chunk under the lock.
5. **Verify** — every entity present in the source must survive in the output. Missing entities are reported, not hidden.

```bash
jpvoice revoice draft.md --voice murakami/rubin --mode revoice
jpvoice revoice draft.md --voice dazai/keene --mode embellish --expand 0.3
jpvoice revoice draft.md --voice kawabata/seidensticker --mode extend --words 1200
```

Modes: `polish` (light touch, register violations only), `revoice` (full register change, facts preserved), `embellish` (revoice plus expansion), `extend` (continue from the end).

## Commands

| Command | What it does |
|---|---|
| `jpvoice voices [key]` | List authors, translators, canonical pairings; show a composed contract |
| `jpvoice score <file>` | Measure a passage; `--explain`, `--json` |
| `jpvoice init <title>` | Create a project; `--voice` optional (defaults to house); `--brief` parses word count and POV |
| `jpvoice plan` | Beat sheet, chapters, scene budgets |
| `jpvoice anchors` | Generate and freeze the drift-control passages |
| `jpvoice draft` | Draft scenes to budget; `--ch 1-4,6`, `--force` |
| `jpvoice polish` | Conformance loop; `--iterations` |
| `jpvoice audit` | Continuity, drift curve, breakers, unpublished threads |
| `jpvoice status` | Scene-by-scene progress and scores |
| `jpvoice compile` | Rebuild `manuscript.md` |
| `jpvoice scale <file> --to N` | Expand or compress in register |
| `jpvoice revoice <file>` | Apply the voice filter to existing text |
| `jpvoice bible` | Inspect or amend entities, facts, threads |
| `jpvoice doctor` | Config, models, voice library health |

`--brief` example:

```bash
jpvoice init "Rental" --brief "first person, 3000 words, murakami-ish" --premise "..."
```

## Architecture

```
src/
  voice/          schema · compose (author ⊗ translator) · render
  metrics/        stylometry · lexicon
  critic/         conformance, severity, critique generation
  pipeline/       brief · planner · budget · context · drafter · polisher · expand · anchors
  retext/         bible extraction · re-voicing · continuation · verification
  audit/          drift curve · continuity · breakers
  store/          project, scene files, manuscript assembly
  llm/            DeepSeek client, JSON extraction, mock mode
  cli.ts
voices/
  authors/*.yaml  poetics, imagery, structure, POV
  translators/*.yaml  syntax, targets, lexicon, tics, exemplars
  house.yaml      the default consensus register
  ensembles/*.yaml  named choruses (weighted blends)
  forms.yaml      flash · short · novella · novel
  pairings.yaml   canonical vs synthetic
```

Passes use different tiers deliberately: **Pro** for structural planning; **Flash** for drafting, anchors, re-voicing, and line editing. The measured routing is in the cost table above.

## Limitations, stated plainly

- **Spec-only conditioning is weaker than exemplars.** The mitigations are the contrastive before/after pairs and the frozen anchors, but this is not the same as conditioning on real translations, and no system that avoids copyrighted text can be.
- **Conformance is a proxy.** A passage can score 95 and still read wrong. The metric catches the failures that are mechanical — which is most of them, at length — not the ones that are structural.
- **The bible is lexical, not semantic.** Continuity checking is heuristic: entity coverage, thread payoff, scene thinness. It will not catch a character knowing something they were absent for.
- **Synthetic pairings are extrapolation.** `murakami/keene` never existed. It is a useful exercise, not a historical voice.
- **Dialogue and POV are prompt-level constraints**, enforced by the contract and the score, not by a grammar.
- **The mock mode is for plumbing, not prose.** It proves the pipeline runs; it says nothing about quality.

## Legal and ethical

No copyrighted text is stored or shipped. Every voice is a hand-authored description of a register plus original contrastive examples. Output is **style emulation**, attributed to no author, and any synthetic pairing is labelled as such in the artifact metadata. If you publish work in an author's register, say so.

## Development

```bash
npm run dev -- voices list
npm test                 # 49 tests: segmentation, stylometry, conformance, budgets, composition, blending
npm run build
npx tsx scripts/demo.ts  # the two-register comparison
```
