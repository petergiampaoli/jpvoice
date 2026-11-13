import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pc from "picocolors";

import { composeVoice, formForWords, type Pov, type Tense } from "../voice/compose.js";
import type { FormSpec } from "../voice/schema.js";
import { structureFor } from "./budget.js";
import { planStory } from "./planner.js";
import { generateAnchors } from "./anchors.js";
import { draftScene } from "./drafter.js";
import { polishScene } from "./polisher.js";
import { auditProject, writeAudit } from "../audit/audit.js";
import {
  compileManuscript,
  initProject,
  jpDir,
  loadProject,
  orderedScenes,
  readScene,
  saveProject,
  syncScenes,
  type Project,
} from "../store/project.js";
import { resetCost, setLogPath, totalCost } from "../llm/client.js";
import { confirm } from "../util/confirm.js";
import { countWords, round } from "../util/text.js";

const STOP_WORDS = new Set([
  "a", "an", "the", "of", "in", "on", "at", "to", "and", "or", "but", "for",
  "from", "by", "as", "that", "this", "these", "those", "with", "without",
  "his", "her", "their", "its", "my", "your", "our", "he", "she", "they",
  "it", "we", "you", "i", "is", "are", "was", "were", "be", "been", "being",
  "who", "whom", "which", "when", "where", "while", "after", "before",
  "over", "under", "into", "onto", "about", "then", "there", "here", "up",
  "down", "out", "off", "one", "two", "twenty", "story", "stories",
]);

export type RunOptions = {
  premise: string;
  words: number;
  voice?: string;
  title?: string;
  path?: string;
  form?: string;
  pov?: Pov;
  tense?: Tense;
  force?: boolean;
  yes?: boolean;
  estimate?: boolean;
};

export type RunDecision = {
  action: "create" | "resume" | "refuse";
  replan: boolean;
  reason?: string;
};

export type RunSummary = {
  workDir: string;
  title: string;
  words: number;
  targetWords: number;
  costUsd: number;
  pass: boolean;
  failures: Array<{ id: string; error: string }>;
  stoppedAtAnchors: boolean;
  audit?: ReturnType<typeof auditProject>;
};

function normalise(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export function slugFromPremise(premise: string): string {
  const words = premise
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w))
    .slice(0, 6);
  return (words.join("-") || "story").slice(0, 48).replace(/-+$/, "");
}

/** A readable working title before the planner supplies one. */
export function titleFromPremise(premise: string): string {
  const words = premise
    .replace(/[.,;:!?]+$/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w.toLowerCase()))
    .slice(0, 4);
  if (words.length === 0) return "Untitled";
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function estimateRun(words: number, form: FormSpec): { scenes: number; costUsd: number } {
  const scenes = structureFor(words, form).totalScenes;
  // Measured: plan ~$0.02, draft ~$0.0008 per 1k words, polish ~$0.002 per scene.
  const costUsd = 0.02 + (words / 1000) * 0.0008 + scenes * 0.002;
  return { scenes, costUsd: round(costUsd, 3) };
}

export function decideRun(args: {
  existing: Project | null;
  premise: string;
  words: number;
  force?: boolean;
}): RunDecision {
  const { existing, force } = args;
  if (!existing) return { action: "create", replan: false };
  if (force) return { action: "create", replan: false };

  if (normalise(existing.meta.premise) !== normalise(args.premise)) {
    return {
      action: "refuse",
      replan: false,
      reason:
        "That directory already holds a different story. Use --path to write somewhere else, or --force to replace it.",
    };
  }

  const drafted = Object.values(existing.scenes).some((s) => s.words > 0);
  if (existing.meta.words !== args.words) {
    if (drafted) {
      return {
        action: "refuse",
        replan: false,
        reason:
          `The word count changed from ${existing.meta.words} to ${args.words} after drafting began. Use --force to start over.`,
      };
    }
    return { action: "resume", replan: true };
  }

  return { action: "resume", replan: false };
}

function wrap(text: string, width = 78): string {
  const out: string[] = [];
  for (const para of text.split(/\n\n/)) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if (line.length + word.length + 1 > width) {
        out.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) out.push(line);
    out.push("");
  }
  return out.join("\n").trimEnd();
}

export async function runStory(opts: RunOptions): Promise<RunSummary> {
  if (!opts.premise.trim()) throw new Error("A premise is required.");
  if (!Number.isFinite(opts.words) || opts.words <= 0) {
    throw new Error("A positive word count is required.");
  }

  const form = opts.form ?? formForWords(opts.words);
  const voice = composeVoice({
    key: opts.voice ?? "house",
    form,
    pov: opts.pov,
    tense: opts.tense,
  });

  const slug = opts.path
    ? resolve(opts.path)
    : resolve("work", slugFromPremise(opts.title ?? opts.premise));
  const { scenes: sceneCount, costUsd } = estimateRun(opts.words, voice.form);
  const workingTitle = opts.title ?? titleFromPremise(opts.premise);

  console.log("");
  console.log(`  ${pc.bold(workingTitle)}`);
  console.log(`  premise   ${opts.premise}`);
  console.log(`  words     ${opts.words.toLocaleString()}  ${pc.dim(`(band ${Math.round(opts.words * 0.95).toLocaleString()}–${Math.round(opts.words * 1.05).toLocaleString()})`)}`);
  console.log(`  voice     ${voice.label}`);
  console.log(`  form      ${voice.form.label} · ${sceneCount} scene${sceneCount === 1 ? "" : "s"}`);
  console.log(`  path      ${slug}`);
  console.log(`  estimate  ~$${costUsd.toFixed(3)}`);
  console.log("");

  if (opts.estimate) {
    return {
      workDir: slug,
      title: workingTitle,
      words: 0,
      targetWords: opts.words,
      costUsd: 0,
      pass: false,
      failures: [],
      stoppedAtAnchors: false,
    };
  }

  const proceed = await confirm("  proceed? [y/N] ", { yes: opts.yes });
  if (!proceed) {
    console.log(pc.dim("  cancelled — nothing spent."));
    console.log("");
    return {
      workDir: slug,
      title: workingTitle,
      words: 0,
      targetWords: opts.words,
      costUsd: 0,
      pass: false,
      failures: [],
      stoppedAtAnchors: false,
    };
  }

  /* --- create or resume --- */
  const existing = existsSync(join(jpDir(slug), "project.json")) ? loadProject(slug) : null;
  const decision = decideRun({
    existing,
    premise: opts.premise,
    words: opts.words,
    force: opts.force,
  });
  if (decision.action === "refuse") throw new Error(decision.reason ?? "Cannot run here.");

  let project: Project;
  if (decision.action === "create") {
    project = initProject(slug, {
      slug: slug.split("/").pop() ?? "story",
      title: workingTitle,
      premise: opts.premise,
      voiceKey: opts.voice ?? "house",
      form,
      words: opts.words,
      pov: voice.pov,
      tense: voice.tense,
    });
  } else {
    project = existing!;
    if (decision.replan) {
      project.meta.words = opts.words;
      project.meta.form = form;
      project.meta.voiceKey = opts.voice ?? project.meta.voiceKey;
      project.plan = null;
      project.scenes = {};
      project.anchors = [];
      saveProject(slug, project);
    }
  }

  setLogPath(join(jpDir(slug), "runs.jsonl"));
  resetCost();

  const failures: Array<{ id: string; error: string }> = [];

  /* --- plan --- */
  if (!project.plan) {
    const { plan } = await planStory({
      premise: project.meta.premise,
      words: project.meta.words,
      voice,
      title: opts.title ?? undefined,
    });
    project.plan = plan;
    if (!opts.title) project.meta.title = plan.title;
    syncScenes(project);
    saveProject(slug, project);
    console.log(
      `  plan      ${pc.green("✓")}  ${plan.title} · ${plan.chapters.length} chapters · ${sceneCount} scenes`,
    );
  } else {
    console.log(`  plan      ${pc.dim("✓  existing plan")}  ${project.meta.title}`);
  }

  /* --- anchors, with a single approval pause --- */
  if (project.anchors.length === 0) {
    const anchors = await generateAnchors({
      voice,
      premise: project.meta.premise,
      count: 3,
      characters: project.plan?.characters,
    });
    project.anchors = anchors;
    saveProject(slug, project);
    writeFileSync(
      join(jpDir(slug), "anchors.md"),
      `# Voice anchors\n\n${anchors.map((a, i) => `## ${i + 1}\n\n${a}`).join("\n\n")}\n`,
      "utf8",
    );
    console.log(`  anchors   ${pc.green("✓")}  ${anchors.length} passages → .jpvoice/anchors.md`);
    console.log("");

    for (const [i, anchor] of anchors.entries()) {
      console.log(pc.dim(`  ── anchor ${i + 1} ${"─".repeat(56)}`));
      console.log(
        wrap(anchor)
          .split("\n")
          .map((l) => `  ${l}`)
          .join("\n"),
      );
      console.log("");
    }

    const approved = await confirm("  proceed with this voice? [Y/n] ", {
      yes: opts.yes,
      defaultYes: true,
    });
    if (!approved) {
      console.log(pc.dim("  stopped at anchors. Nothing drafted."));
      console.log(pc.dim(`  resume with: jpvoice --premise "${opts.premise}" --wordcount ${opts.words} --path ${slug}`));
      console.log("");
      return {
        workDir: slug,
        title: project.meta.title,
        words: 0,
        targetWords: opts.words,
        costUsd: totalCost(),
        pass: false,
        failures,
        stoppedAtAnchors: true,
      };
    }
  } else {
    console.log(`  anchors   ${pc.dim("✓  existing anchors")}`);
  }

  /* --- draft --- */
  const scenes = orderedScenes(project);
  const drafted: string[] = [];
  for (const scene of scenes) {
    const existingText = readScene(slug, scene.id);
    if (existingText && countWords(existingText) > 0) continue;
    try {
      const result = await draftScene({ workDir: slug, project, voice, sceneId: scene.id });
      drafted.push(`${scene.id} ${result.words}w`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ id: scene.id, error: message });
      drafted.push(`${scene.id} ${pc.red("failed")}`);
    }
  }
  console.log(
    `  draft     ${failures.length ? pc.yellow("!") : pc.green("✓")}  ${drafted.length ? drafted.join("  ") : pc.dim("nothing to draft")}`,
  );

  /* --- polish --- */
  const polished: string[] = [];
  for (const scene of scenes) {
    const body = readScene(slug, scene.id);
    if (!body) continue;
    try {
      const result = await polishScene({
        workDir: slug,
        project,
        voice,
        sceneId: scene.id,
        iterations: 2,
      });
      if (result.changed) {
        polished.push(`${scene.id} ${result.before.score}→${result.after.score}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ id: scene.id, error: message });
    }
  }
  console.log(
    `  polish    ${failures.length ? pc.yellow("!") : pc.green("✓")}  ${polished.length ? polished.join("  ") : pc.dim("all scenes passing")}`,
  );

  /* --- audit + compile --- */
  const audit = auditProject({ workDir: slug, project, voice });
  writeAudit({ workDir: slug, project, audit });
  const text = compileManuscript(slug, project);
  const words = countWords(text);

  console.log(
    `  audit     ${audit.pass ? pc.green("✓") : pc.yellow("!")}  ${audit.pass ? "PASS" : "NEEDS WORK"} · ${audit.breakers.length} breakers · ${audit.continuity.thinScenes.length} thin scenes`,
  );
  console.log("");
  console.log(
    `  ${words.toLocaleString()} / ${opts.words.toLocaleString()} words · $${totalCost().toFixed(3)} · ${pc.cyan(join(slug, "manuscript.md"))}`,
  );

  if (audit.curve.length) {
    const weakest = [...audit.scenes].filter((s) => s.words > 0).sort((a, b) => a.score - b.score)[0];
    if (weakest) console.log(pc.dim(`  weakest scene: ${weakest.id} at ${weakest.score}/100`));
  }
  for (const f of failures) console.log(pc.red(`  failed ${f.id}: ${f.error}`));
  console.log("");

  return {
    workDir: slug,
    title: project.meta.title,
    words,
    targetWords: opts.words,
    costUsd: totalCost(),
    pass: audit.pass && failures.length === 0,
    failures,
    stoppedAtAnchors: false,
    audit,
  };
}
