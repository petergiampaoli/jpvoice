#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { Command } from "commander";
import pc from "picocolors";

import { composeVoice, formForWords } from "./voice/compose.js";
import { findAuthor, findTranslator, loadAuthors, loadPairings, loadTranslators, voicesDir } from "./voice/load.js";
import { renderVoiceSpec } from "./voice/render.js";
import type { EffectiveVoice } from "./voice/schema.js";
import { analyze, detectNames } from "./metrics/stylometry.js";
import { countWords, splitSentences } from "./util/text.js";
import { scoreText } from "./pipeline/score.js";
import { planStory } from "./pipeline/planner.js";
import { generateAnchors } from "./pipeline/anchors.js";
import { draftAll } from "./pipeline/drafter.js";
import { polishAll, characterNames } from "./pipeline/polisher.js";
import { rescaleText } from "./pipeline/expand.js";
import { parseBrief } from "./pipeline/brief.js";
import { auditProject, writeAudit, renderAuditMarkdown } from "./audit/audit.js";
import { revoiceText, continueText, extractBible, type RevoiceMode } from "./retext/revoice.js";
import {
  compileManuscript,
  findWorkDir,
  initProject,
  jpDir,
  loadProject,
  orderedScenes,
  readScene,
  saveProject,
  slugify,
  syncScenes,
  writeScene,
  type Project,
  type SceneState,
} from "./store/project.js";
import { loadConfig } from "./config.js";
import { resetCost, setLogPath, totalCost } from "./llm/client.js";

const program = new Command();

program
  .name("jpvoice")
  .description("Voice-conditioned story builder for the translated-Japanese register")
  .version("0.1.0")
  .option("--dir <path>", "project directory (defaults to the nearest .jpvoice)")
  .hook("preAction", (thisCommand, actionCommand) => {
    const opts = thisCommand.opts();
    if (actionCommand.name() !== "init" && opts.dir) process.chdir(resolve(opts.dir));
  });

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function workDir(): string {
  return findWorkDir(process.cwd());
}

function requireProject(): { dir: string; project: Project } {
  const dir = workDir();
  return { dir, project: loadProject(dir) };
}

function resolveVoice(opts: { voice?: string; form?: string }, project?: Project): EffectiveVoice {
  const key = opts.voice ?? project?.meta.voiceKey;
  if (!key) throw new Error("No voice specified. Use --voice author/translator (see `jpvoice voices list`).");
  const form = opts.form ?? project?.meta.form ?? "short";
  return composeVoice({
    key,
    form,
    pov: project?.meta.pov as EffectiveVoice["pov"] | undefined,
    tense: project?.meta.tense as EffectiveVoice["tense"] | undefined,
  });
}

function parseChapterRange(spec?: string): Set<number> | null {
  if (!spec) return null;
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.add(i);
    } else if (/^\d+$/.test(trimmed)) {
      out.add(Number(trimmed));
    }
  }
  return out.size ? out : null;
}

function selectScenes(
  project: Project,
  opts: { ch?: string; scene?: string },
): SceneState[] {
  let scenes = orderedScenes(project);
  const chapters = parseChapterRange(opts.ch);
  if (chapters) scenes = scenes.filter((s) => chapters.has(s.chapter));
  if (opts.scene) {
    const needle = opts.scene.toLowerCase();
    scenes = scenes.filter(
      (s) => s.id.toLowerCase() === needle || s.id.toLowerCase().endsWith(needle),
    );
  }
  return scenes;
}

function bar(value: number, min: number, max: number, width = 16): string {
  if (max <= min) return " ".repeat(width);
  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const filled = Math.round(ratio * width);
  return "█".repeat(filled) + "·".repeat(width - filled);
}

function verdictColor(pass: boolean, score: number): string {
  const label = `${score}/100`;
  if (pass) return pc.green(label);
  if (score >= 70) return pc.yellow(label);
  return pc.red(label);
}

function printMetrics(m: ReturnType<typeof analyze>, voice: EffectiveVoice, pass: boolean, score: number): void {
  const rows: Array<[string, string, string, string]> = [
    ["words", String(m.words), "", ""],
    ["sentences", String(m.sentences), "", ""],
    ["mean sentence", String(m.meanSentenceWords), band(voice.targets.meanSentenceWords), bar(m.meanSentenceWords, 0, 40)],
    ["short (≤8w)", (m.shortSentenceRatio * 100).toFixed(0) + "%", bandPct(voice.targets.shortSentenceRatio), bar(m.shortSentenceRatio, 0, 1)],
    ["long (≥35w)", (m.longSentenceRatio * 100).toFixed(0) + "%", bandPct(voice.targets.longSentenceRatio), bar(m.longSentenceRatio, 0, 0.3)],
    ["hedges /1k", String(m.hedgePer1k), band(voice.targets.hedgePer1k), bar(m.hedgePer1k, 0, 30)],
    ["filter v /1k", String(m.filterVerbPer1k), band(voice.targets.filterVerbPer1k), bar(m.filterVerbPer1k, 0, 30)],
    ["abstract", (m.abstractionRatio * 100).toFixed(1) + "%", bandPct(voice.targets.abstractionRatio), bar(m.abstractionRatio, 0, 0.12)],
    ["similes /1k", String(m.similePer1k), band(voice.targets.similePer1k), bar(m.similePer1k, 0, 8)],
    ["adverbs", (m.adverbRatio * 100).toFixed(1) + "%", bandPct(voice.targets.adverbRatio), bar(m.adverbRatio, 0, 0.08)],
    ["dialogue", (m.dialogueRatio * 100).toFixed(0) + "%", bandPct(voice.targets.dialogueRatio), bar(m.dialogueRatio, 0, 0.6)],
    ["names/pronoun", String(m.nameToPronounRatio), band(voice.targets.nameToPronounRatio), bar(m.nameToPronounRatio, 0, 3)],
    ["em dash /1k", String(m.emDashPer1k), band(voice.targets.emDashPer1k), ""],
    ["ellipsis /1k", String(m.ellipsisPer1k), band(voice.targets.ellipsisPer1k), ""],
    ["exclaim /1k", String(m.exclamationPer1k), band(voice.targets.exclamationPer1k), ""],
    ["semicolon /1k", String(m.semicolonPer1k), band(voice.targets.semicolonPer1k), ""],
    ["paragraph avg", String(m.avgParagraphWords), band(voice.targets.avgParagraphWords), ""],
  ];

  console.log("");
  console.log(pc.bold("  metric            value    target            "));
  for (const [label, value, target, b] of rows) {
    console.log(
      `  ${label.padEnd(17)} ${value.padEnd(8)} ${target.padEnd(17)} ${pc.dim(b)}`,
    );
  }
  console.log("");
  console.log(`  conformance: ${verdictColor(pass, score)}`);
  console.log("");
}

function band(b: [number, number] | undefined): string {
  return b ? `${b[0]}–${b[1]}` : "";
}
function bandPct(b: [number, number] | undefined): string {
  return b ? `${Math.round(b[0] * 100)}–${Math.round(b[1] * 100)}%` : "";
}

/* ------------------------------------------------------------------ */
/* voices                                                              */
/* ------------------------------------------------------------------ */

program
  .command("voices")
  .argument("[target]", "author/translator key to inspect")
  .option("-f, --form <form>", "form to compose against", "short")
  .description("List the voice library, or show a composed register")
  .action((target: string | undefined, opts: { form: string }) => {
    if (target) {
      const voice = composeVoice({ key: target, form: opts.form });
      console.log(renderVoiceSpec(voice));
      return;
    }

    const authors = loadAuthors();
    const translators = loadTranslators();
    const pairings = loadPairings();

    console.log("");
    console.log(pc.bold("  AUTHORS"));
    for (const a of authors) {
      console.log(`  ${a.id.padEnd(14)} ${a.display.padEnd(24)} ${pc.dim(a.tradition ?? "")}`);
    }
    console.log("");
    console.log(pc.bold("  TRANSLATORS"));
    for (const t of translators) {
      console.log(`  ${t.id.padEnd(14)} ${t.display.padEnd(24)} ${pc.dim(t.archetype)}`);
    }
    console.log("");
    console.log(pc.bold("  CANONICAL PAIRINGS"));
    const canonical = [...pairings.entries()].filter(([, v]) => v === "canonical");
    for (const [key] of canonical) console.log(`  ${key}`);
    console.log("");
    console.log(
      pc.dim(`  ${authors.length} authors × ${translators.length} translators = ${authors.length * translators.length} voices.`),
    );
    console.log(pc.dim(`  ${canonical.length} are historical pairings; the rest are labelled synthetic.`));
    console.log("");
  });

/* ------------------------------------------------------------------ */
/* score                                                               */
/* ------------------------------------------------------------------ */

program
  .command("score")
  .argument("<file>", "prose file to measure")
  .option("-v, --voice <key>", "author/translator")
  .option("-f, --form <form>", "flash | short | novella | novel")
  .option("--json", "machine-readable output")
  .option("--explain", "print conformance issues")
  .description("Measure a passage against a voice contract")
  .action((file: string, opts: { voice?: string; form?: string; json?: boolean; explain?: boolean }) => {
    const text = readFileSync(resolve(file), "utf8");
    const voice = resolveVoice(opts);
    const names = detectNames(text);
    const { metrics, report } = scoreText(text, voice, names);

    if (opts.json) {
      console.log(JSON.stringify({ voice: voice.key, metrics, report }, null, 2));
      return;
    }

    console.log(pc.bold(`\n  ${file}`));
    console.log(pc.dim(`  ${voice.label} · ${voice.status} · ${voice.form.label} · ${voice.pov}/${voice.tense}`));
    printMetrics(metrics, voice, report.pass, report.score);

    if (opts.explain) {
      if (report.issues.length === 0) {
        console.log(pc.green("  No issues. The passage is inside the contract.\n"));
      } else {
        for (const issue of report.issues) {
          const tag =
            issue.severity === "high" ? pc.red("HIGH") : issue.severity === "medium" ? pc.yellow("MED") : pc.dim("LOW");
          console.log(`  ${tag}  ${issue.label} — ${issue.value}${issue.band ? ` (target ${issue.band[0]}–${issue.band[1]})` : ""}`);
          console.log(`        ${pc.dim(issue.fix)}`);
        }
        console.log("");
      }
    }
  });

/* ------------------------------------------------------------------ */
/* init                                                                */
/* ------------------------------------------------------------------ */

program
  .command("init")
  .argument("<title>", "working title")
  .option("-v, --voice <key>", "author/translator")
  .option("-w, --words <n>", "target word count")
  .option("-p, --premise <text>", "story premise")
  .option("-f, --form <form>", "flash | short | novella | novel")
  .option("--pov <pov>", "first | third-limited | third-omniscient")
  .option("--tense <tense>", "past | present")
  .option("-b, --brief <text>", "free-form brief, parsed for word count and POV")
  .option("--path <path>", "directory to create")
  .description("Create a story project")
  .action(
    (
      title: string,
      opts: {
        voice?: string;
        words?: string;
        premise?: string;
        form?: string;
        pov?: string;
        tense?: string;
        brief?: string;
        path?: string;
      },
    ) => {
      const brief = opts.brief ? parseBrief(opts.brief) : {};
      const words = Number(opts.words ?? brief.words ?? 3000);
      const form = opts.form ?? brief.form ?? formForWords(words);
      const voiceKey = opts.voice ?? brief.voiceKey;

      if (!voiceKey) {
        throw new Error(
          "Choose a voice with --voice. Try:\n" +
            "  jpvoice init \"Title\" --voice kawabata/seidensticker --words 4000\n" +
            "  jpvoice init \"Title\" --voice murakami/rubin --words 30000",
        );
      }

      const voice = composeVoice({
        key: voiceKey,
        form,
        pov: (opts.pov ?? brief.pov) as EffectiveVoice["pov"] | undefined,
        tense: (opts.tense ?? brief.tense) as EffectiveVoice["tense"] | undefined,
      });

      const slug = slugify(title);
      const dir = resolve(opts.path ?? join(process.cwd(), slug));
      mkdirSync(dir, { recursive: true });

      const project = initProject(dir, {
        slug,
        title,
        premise: opts.premise ?? "",
        voiceKey: voice.key,
        form,
        words,
        pov: voice.pov,
        tense: voice.tense,
      });

      console.log("");
      console.log(`  ${pc.green("created")} ${join(dir, ".jpvoice")}`);
      console.log(`  voice    ${voice.label}`);
      console.log(`  pairing  ${voice.status}`);
      console.log(`  form     ${voice.form.label}`);
      console.log(`  words    ${words.toLocaleString()}  (band ${Math.round(words * 0.95).toLocaleString()}–${Math.round(words * 1.05).toLocaleString()})`);
      console.log(`  pov      ${voice.pov} / ${voice.tense}`);
      const scenes = Math.max(1, Math.round(words / ((voice.form.wordsPerScene[0] + voice.form.wordsPerScene[1]) / 2)));
      console.log(`  scenes   ~${scenes} × ${Math.round(words / scenes)} words`);
      console.log("");
      const rel = relative(process.cwd(), dir) || ".";
      console.log(pc.dim(`  next: cd ${rel} && jpvoice plan`));
      console.log("");
      void project;
    },
  );

/* ------------------------------------------------------------------ */
/* plan                                                                */
/* ------------------------------------------------------------------ */

program
  .command("plan")
  .option("--rewrite", "discard an existing plan")
  .description("Build the beat sheet and word budgets")
  .action(async (opts: { rewrite?: boolean }) => {
    const { dir, project } = requireProject();
    if (project.plan && !opts.rewrite) {
      console.log(pc.yellow("  A plan already exists. Use --rewrite to replace it."));
      return;
    }

    const voice = resolveVoice({}, project);
    if (!project.meta.premise) {
      throw new Error("No premise set. Re-run init with --premise, or edit .jpvoice/project.json.");
    }

    console.log(pc.dim(`  planning ${project.meta.words.toLocaleString()} words in ${voice.label}...`));
    const { plan } = await planStory({
      premise: project.meta.premise,
      words: project.meta.words,
      voice,
      title: project.meta.title,
    });

    project.plan = plan;
    syncScenes(project);
    saveProject(dir, project);

    console.log("");
    console.log(`  ${pc.bold(plan.title)}`);
    if (plan.logline) console.log(`  ${pc.dim(plan.logline)}`);
    console.log("");
    let total = 0;
    for (const ch of plan.chapters) {
      const w = ch.scenes.reduce((s, x) => s + x.targetWords, 0);
      total += w;
      console.log(`  ${String(ch.number).padStart(2)}  ${ch.title.padEnd(28)} ${String(w).padStart(6)} words   ${pc.dim(ch.function)}`);
      for (const s of ch.scenes) {
        console.log(`      ${pc.dim(s.id)}  ${String(s.targetWords).padStart(5)}w  ${truncate(s.beat, 86)}`);
      }
    }
    console.log("");
    console.log(`  total ${total.toLocaleString()} words across ${plan.chapters.length} chapters`);
    console.log(pc.dim("  next: jpvoice anchors"));
    console.log("");
  });

/* ------------------------------------------------------------------ */
/* anchors                                                             */
/* ------------------------------------------------------------------ */

program
  .command("anchors")
  .option("-n, --count <n>", "number of anchors", "3")
  .option("--show", "print the stored anchors")
  .option("--clear", "remove stored anchors")
  .description("Generate the frozen voice anchors used for drift control")
  .action(async (opts: { count: string; show?: boolean; clear?: boolean }) => {
    const { dir, project } = requireProject();

    if (opts.clear) {
      project.anchors = [];
      saveProject(dir, project);
      writeFileSync(join(jpDir(dir), "anchors.md"), "# Voice anchors\n\n", "utf8");
      console.log("  cleared anchors");
      return;
    }

    if (opts.show || project.anchors.length > 0) {
      if (project.anchors.length === 0) {
        console.log(pc.yellow("  No anchors stored. Run `jpvoice anchors` to generate."));
        return;
      }
      project.anchors.forEach((a, i) => {
        console.log(pc.bold(`\n  --- anchor ${i + 1} ---\n`));
        console.log(wrap(a, 88));
      });
      console.log("");
      return;
    }

    const voice = resolveVoice({}, project);
    console.log(pc.dim("  generating anchors in register..."));
    const anchors = await generateAnchors({
      voice,
      premise: project.meta.premise,
      count: Number(opts.count),
      characters: project.plan?.characters,
    });

    project.anchors = anchors;
    saveProject(dir, project);
    writeFileSync(
      join(jpDir(dir), "anchors.md"),
      "# Voice anchors\n\n" + anchors.map((a, i) => `## ${i + 1}\n\n${a}`).join("\n\n") + "\n",
      "utf8",
    );

    anchors.forEach((a, i) => {
      console.log(pc.bold(`\n  --- anchor ${i + 1} ---\n`));
      console.log(wrap(a, 88));
    });
    console.log("");
    console.log(pc.dim("  Review these. If the voice is wrong, fix the spec, not the anchors."));
    console.log(pc.dim("  These are re-injected into every scene to prevent drift."));
    console.log("");
  });

/* ------------------------------------------------------------------ */
/* draft                                                               */
/* ------------------------------------------------------------------ */

program
  .command("draft")
  .option("--ch <range>", "chapters, e.g. 1-4,6")
  .option("--scene <id>", "single scene id")
  .option("--force", "redraft scenes that already exist")
  .description("Draft scenes to their word budgets")
  .action(async (opts: { ch?: string; scene?: string; force?: boolean }) => {
    const { dir, project } = requireProject();
    if (!project.plan) throw new Error("No plan yet. Run `jpvoice plan`.");
    const voice = resolveVoice({}, project);
    const scenes = selectScenes(project, opts);
    if (scenes.length === 0) throw new Error("No scenes matched.");

    setLogPath(join(jpDir(dir), "runs.jsonl"));
    resetCost();

    console.log(
      pc.dim(`  drafting ${scenes.length} scene(s) in ${voice.label} · ${project.meta.words.toLocaleString()} target words`),
    );

    for (const scene of scenes) {
      const started = Date.now();
      const r = await draftAll({
        workDir: dir,
        project,
        voice,
        from: scene.id,
        to: scene.id,
        force: opts.force,
      });
      const result = r[0];
      if (!result) continue;
      const flag = result.skipped ? pc.dim("skip") : pc.green("ok");
      console.log(
        `  ${flag.padEnd(14)} ${scene.id}  ${String(result.words).padStart(5)} / ${String(scene.targetWords).padStart(5)} words  ${pc.dim(
          ((Date.now() - started) / 1000).toFixed(1) + "s",
        )}`,
      );
    }

    compileManuscript(dir, project);
    console.log("");
    console.log(`  ${pc.green("manuscript.md")} updated · ${pc.dim("$" + totalCost().toFixed(3))}`);
    console.log(pc.dim("  next: jpvoice polish"));
    console.log("");
  });

/* ------------------------------------------------------------------ */
/* polish                                                              */
/* ------------------------------------------------------------------ */

program
  .command("polish")
  .option("--ch <range>", "chapters, e.g. 1-4,6")
  .option("--scene <id>", "single scene id")
  .option("-i, --iterations <n>", "revision rounds per scene", "2")
  .description("Run the conformance loop against the voice contract")
  .action(async (opts: { ch?: string; scene?: string; iterations: string }) => {
    const { dir, project } = requireProject();
    if (!project.plan) throw new Error("No plan yet. Run `jpvoice plan`.");
    const voice = resolveVoice({}, project);
    const scenes = selectScenes(project, opts).filter((s) => readScene(dir, s.id));

    if (scenes.length === 0) {
      console.log(pc.yellow("  No drafted scenes matched. Run `jpvoice draft` first."));
      return;
    }

    setLogPath(join(jpDir(dir), "runs.jsonl"));
    resetCost();

    console.log(pc.dim(`  polishing ${scenes.length} scene(s) · voice ${voice.key}`));
    console.log("");

    for (const scene of scenes) {
      const body = readScene(dir, scene.id)!;
      const before = scoreText(body, voice, characterNames(project)).report;
      const r = await polishAll({
        workDir: dir,
        project,
        voice,
        from: scene.id,
        to: scene.id,
        iterations: Number(opts.iterations),
      });
      const after = r[0];
      if (!after) continue;
      const arrow = after.score > before.score ? pc.green("↑") : after.score < before.score ? pc.red("↓") : pc.dim("→");
      console.log(
        `  ${scene.id}  ${verdictColor(before.pass, before.score)} → ${verdictColor(after.pass, after.score)} ${arrow} ${pc.dim(
          after.changed ? "revised" : "kept",
        )}`,
      );
    }

    compileManuscript(dir, project);
    console.log("");
    console.log(`  ${pc.green("manuscript.md")} updated · ${pc.dim("$" + totalCost().toFixed(3))}`);
    console.log("");
  });

/* ------------------------------------------------------------------ */
/* audit                                                               */
/* ------------------------------------------------------------------ */

program
  .command("audit")
  .option("--json", "machine-readable output")
  .description("Continuity, drift curve, and register breakers across the whole work")
  .action((opts: { json?: boolean }) => {
    const { dir, project } = requireProject();
    if (!project.plan) throw new Error("No plan yet. Run `jpvoice plan`.");
    const voice = resolveVoice({}, project);
    const audit = auditProject({ workDir: dir, project, voice });

    if (opts.json) {
      console.log(JSON.stringify(audit, null, 2));
      return;
    }

    console.log("");
    console.log(`  ${pc.bold(project.meta.title)}  ${pc.dim(project.meta.voiceKey)}`);
    console.log(
      `  ${audit.totals.words.toLocaleString()} / ${audit.totals.target.toLocaleString()} words · ` +
        `${audit.totals.drafted}/${audit.totals.scenes} scenes · ` +
        (audit.pass ? pc.green("PASS") : pc.yellow("NEEDS WORK")),
    );
    console.log("");

    console.log(pc.bold("  drift curve"));
    for (const c of audit.curve) {
      console.log(
        `  ch ${String(c.chapter).padStart(2)}  ${bar(c.meanScore, 0, 100, 24)} ${String(c.meanScore).padStart(3)}  ${pc.dim(
          `${c.words}/${c.target} words`,
        )}`,
      );
    }
    console.log("");
    console.log(
      `  first→last: score ${signed(audit.drift.scoreDrop)}, sentence length ${signed(audit.drift.meanSentenceWords)}, ` +
        `names/pronoun ${signed(audit.drift.nameToPronounRatio)}, hedges ${signed(audit.drift.hedgePer1k)}`,
    );
    console.log("");

    if (audit.breakers.length) {
      console.log(pc.bold("  register breakers"));
      for (const b of audit.breakers.slice(0, 12)) {
        console.log(`  ${pc.red("×" + b.count)}  ${b.phrase}  ${pc.dim(b.scenes.join(", "))}`);
      }
      console.log("");
    }

    if (audit.ticOverruns.length) {
      console.log(pc.bold("  tic overruns"));
      for (const t of audit.ticOverruns) {
        console.log(`  ${t.worst}/1k  "${t.phrase}"  ${pc.dim(t.scenes.join(", "))}`);
      }
      console.log("");
    }

    const c = audit.continuity;
    if (c.emptyScenes.length || c.thinScenes.length || c.absentEntities.length || c.unansweredThreads.length) {
      console.log(pc.bold("  continuity"));
      if (c.emptyScenes.length) console.log(`  undrafted: ${c.emptyScenes.join(", ")}`);
      if (c.thinScenes.length) console.log(`  thin (<60%): ${c.thinScenes.join(", ")}`);
      if (c.absentEntities.length) console.log(`  never appear: ${c.absentEntities.join(", ")}`);
      for (const t of c.unansweredThreads) console.log(`  thread without payoff: ${t}`);
      console.log("");
    }

    const report = writeAudit({ workDir: dir, project, audit });
    console.log(pc.dim(`  report → ${report}`));
    console.log("");
  });

/* ------------------------------------------------------------------ */
/* status                                                              */
/* ------------------------------------------------------------------ */

program
  .command("status")
  .description("Scene-by-scene progress")
  .action(() => {
    const { dir, project } = requireProject();
    if (!project.plan) {
      console.log(pc.yellow("  No plan yet. Run `jpvoice plan`."));
      return;
    }
    const voice = resolveVoice({}, project);

    console.log("");
    console.log(`  ${pc.bold(project.meta.title)}  ${pc.dim(project.meta.voiceKey)}`);
    console.log("");
    let doneWords = 0;
    let targetWords = 0;
    for (const scene of orderedScenes(project)) {
      const body = readScene(dir, scene.id);
      const words = body ? countWords(body) : 0;
      doneWords += words;
      targetWords += scene.targetWords;
      const { report } = body ? scoreText(body, voice, characterNames(project)) : { report: null };
      const status =
        words === 0 ? pc.dim("pending") : report?.pass ? pc.green("pass") : pc.yellow("draft");
      console.log(
        `  ${scene.id}  ${status.padEnd(16)} ${String(words).padStart(5)} / ${String(scene.targetWords).padStart(5)}  ${
          report ? verdictColor(report.pass, report.score) : pc.dim("—")
        }  ${pc.dim(truncate(scene.beat, 52))}`,
      );
    }
    console.log("");
    const ratio = targetWords ? doneWords / targetWords : 0;
    console.log(
      `  ${doneWords.toLocaleString()} / ${targetWords.toLocaleString()} words  ${bar(ratio, 0, 1, 30)} ${(ratio * 100).toFixed(0)}%`,
    );
    console.log("");
  });

/* ------------------------------------------------------------------ */
/* compile                                                             */
/* ------------------------------------------------------------------ */

program
  .command("compile")
  .description("Assemble manuscript.md from the scene files")
  .action(() => {
    const { dir, project } = requireProject();
    const text = compileManuscript(dir, project);
    console.log(`  ${pc.green("manuscript.md")} · ${countWords(text).toLocaleString()} words`);
  });

/* ------------------------------------------------------------------ */
/* scale                                                               */
/* ------------------------------------------------------------------ */

program
  .command("scale")
  .argument("<file>", "prose file")
  .requiredOption("--to <n>", "target word count")
  .option("-v, --voice <key>", "author/translator")
  .option("-f, --form <form>", "form")
  .option("-o, --out <path>", "output path")
  .description("Expand or compress a piece using the voice's legal moves")
  .action(async (file: string, opts: { to: string; voice?: string; form?: string; out?: string }) => {
    const text = readFileSync(resolve(file), "utf8");
    const voice = resolveVoice(opts);
    const target = Number(opts.to);
    const res = await rescaleText({ text, voice, toWords: target });
    const out = resolve(opts.out ?? file.replace(/\.md$/, "") + `.${target}w.md`);
    writeFileSync(out, res.text.trim() + "\n", "utf8");

    const { report } = scoreText(res.text, voice, detectNames(res.text));
    console.log("");
    console.log(`  ${res.before} → ${res.after} words (target ${target}) · ${res.calls} call(s)`);
    console.log(`  conformance ${verdictColor(report.pass, report.score)}`);
    console.log(`  ${pc.green(out)}`);
    console.log("");
  });

/* ------------------------------------------------------------------ */
/* revoice                                                             */
/* ------------------------------------------------------------------ */

program
  .command("revoice")
  .argument("<file>", "existing prose to re-voice")
  .option("-v, --voice <key>", "author/translator")
  .option("-m, --mode <mode>", "polish | revoice | embellish | extend", "revoice")
  .option("-w, --words <n>", "words to add when --mode extend")
  .option("--expand <ratio>", "expansion ratio for embellish, e.g. 0.3")
  .option("-o, --out <path>", "output path")
  .description("Apply the voice filter to existing text, with fact locking and verification")
  .action(
    async (
      file: string,
      opts: { voice?: string; mode: string; words?: string; expand?: string; out?: string },
    ) => {
      const text = readFileSync(resolve(file), "utf8");
      const voice = resolveVoice(opts);
      const out = resolve(opts.out ?? file.replace(/\.md$/, "") + `.${voice.author.id}.md`);

      if (opts.mode === "extend") {
        const added = await continueText({
          text,
          voice,
          words: Number(opts.words ?? 800),
        });
        const combined = text.trim() + "\n\n" + added.trim() + "\n";
        writeFileSync(out, combined, "utf8");
        console.log(`  added ${countWords(added)} words · ${pc.green(out)}`);
        return;
      }

      const mode = (["polish", "revoice", "embellish"].includes(opts.mode) ? opts.mode : "revoice") as RevoiceMode;
      console.log(pc.dim(`  extracting story bible...`));
      const bible = await extractBible(text);
      console.log(
        pc.dim(
          `  ${bible.entities.length} entities · ${bible.facts.length} facts · ${bible.events.length} events · ${bible.threads.length} threads`,
        ),
      );

      console.log(pc.dim(`  re-voicing ${countWords(text)} words in ${voice.label} (${mode})...`));
      const res = await revoiceText({
        text,
        voice,
        mode,
        bible,
        expandBy: opts.expand ? Number(opts.expand) : undefined,
      });

      writeFileSync(out, res.text.trim() + "\n", "utf8");

      const { report } = scoreText(res.text, voice, detectNames(res.text));
      console.log("");
      console.log(`  ${res.before} → ${res.after} words · ${res.chunks} chunk(s)`);
      console.log(`  conformance ${verdictColor(report.pass, report.score)}`);
      if (res.entitiesChecked) {
        const missing = res.entitiesMissing;
        const status = missing.length === 0 ? pc.green("all present") : pc.red(`${missing.length} missing`);
        console.log(`  entities: ${res.entitiesChecked - missing.length}/${res.entitiesChecked} ${status}`);
        if (missing.length) console.log(`  ${pc.dim("missing: " + missing.join(", "))}`);
      }
      console.log(`  ${pc.green(out)}`);
      console.log("");
    },
  );

/* ------------------------------------------------------------------ */
/* bible                                                               */
/* ------------------------------------------------------------------ */

program
  .command("bible")
  .argument("[action]", "show | add | thread | entity", "show")
  .argument("[value]", "text to add")
  .description("Inspect or amend the story state")
  .action((action: string, value: string | undefined) => {
    const { dir, project } = requireProject();

    if (action === "add" && value) {
      project.bible.facts.push(value);
      saveProject(dir, project);
      console.log(`  fact added: ${value}`);
      return;
    }
    if (action === "thread" && value) {
      project.bible.threads.push(value);
      saveProject(dir, project);
      console.log(`  thread added: ${value}`);
      return;
    }
    if (action === "entity" && value) {
      const [name, ...rest] = value.split("|");
      project.bible.entities.push({
        name: (name ?? "").trim(),
        role: (rest[0] ?? "").trim() || "character",
        note: (rest.slice(1).join("|") ?? "").trim(),
      });
      saveProject(dir, project);
      console.log(`  entity added: ${name}`);
      return;
    }

    console.log("");
    if (project.bible.entities.length) {
      console.log(pc.bold("  entities"));
      for (const e of project.bible.entities) console.log(`  ${e.name}  ${pc.dim(e.role + " · " + e.note)}`);
      console.log("");
    }
    if (project.bible.facts.length) {
      console.log(pc.bold("  facts"));
      for (const f of project.bible.facts) console.log(`  - ${f}`);
      console.log("");
    }
    if (project.bible.threads.length) {
      console.log(pc.bold("  threads"));
      for (const t of project.bible.threads) console.log(`  - ${t}`);
      console.log("");
    }
    if (!project.bible.entities.length && !project.bible.facts.length && !project.bible.threads.length) {
      console.log(pc.dim("  empty. Use `jpvoice bible add \"a fact\"` or the revoice pipeline."));
      console.log("");
    }
  });

/* ------------------------------------------------------------------ */
/* doctor                                                              */
/* ------------------------------------------------------------------ */

program
  .command("doctor")
  .description("Check configuration, API access, and the voice library")
  .action(async () => {
    const cfg = loadConfig();
    console.log("");
    console.log(`  provider     ${cfg.provider}`);
    console.log(`  auth         ${cfg.mock ? pc.yellow("mock mode") : cfg.apiKey ? pc.green("ok") : pc.red("missing")}  ${pc.dim(cfg.authSource)}`);
    console.log(`  base url     ${cfg.baseUrl}`);
    console.log(`  model flash  ${cfg.models.flash}   ${pc.dim(`$${cfg.pricing.flash.in}/$${cfg.pricing.flash.out} per M`)}`);
    console.log(`  model pro    ${cfg.models.pro}   ${pc.dim(`$${cfg.pricing.pro.in}/$${cfg.pricing.pro.out} per M`)}`);
    console.log(`  billing      ${cfg.peak ? pc.yellow("peak") : pc.green("off-peak")}`);
    console.log(`  effort       flash=${cfg.effort.flash}  pro=${cfg.effort.pro}`);
    console.log(`  polish tier  ${cfg.polishTier}`);
    console.log(`  voices dir   ${voicesDir()}`);
    console.log(`  authors      ${loadAuthors().length}`);
    console.log(`  translators  ${loadTranslators().length}`);
    console.log(`  pairings     ${loadPairings().size}`);
    const sample = "The room was cold. She put the bag on the table.";
    console.log(`  pipeline     ${splitSentences(sample).length} sentences parsed from sample`);
    console.log("");
  });

/* ------------------------------------------------------------------ */

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function wrap(text: string, width: number): string {
  const out: string[] = [];
  for (const para of text.split(/\n\n/)) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if (line.length + word.length + 1 > width) {
        out.push(line);
        line = word;
      } else {
        line = line ? line + " " + word : word;
      }
    }
    if (line) out.push(line);
    out.push("");
  }
  return out.join("\n").trimEnd();
}

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("");
  console.error(pc.red("  error: ") + msg);
  console.error("");
  process.exitCode = 1;
});
