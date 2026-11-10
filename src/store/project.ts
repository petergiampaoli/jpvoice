import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { StoryPlan } from "../pipeline/budget.js";

export type ProjectMeta = {
  slug: string;
  title: string;
  premise: string;
  voiceKey: string;
  form: string;
  words: number;
  pov: string;
  tense: string;
  createdAt: string;
  updatedAt: string;
};

export type SceneState = {
  id: string;
  chapter: number;
  beat: string;
  targetWords: number;
  words: number;
  status: "pending" | "drafted" | "polished";
  score?: number;
  passes: number;
  updatedAt?: string;
};

export type Bible = {
  entities: Array<{ name: string; role: string; note: string }>;
  facts: string[];
  threads: string[];
  events: string[];
  knowledge: Array<{ character: string; knows: string }>;
};

export type Project = {
  meta: ProjectMeta;
  plan: StoryPlan | null;
  scenes: Record<string, SceneState>;
  anchors: string[];
  bible: Bible;
};

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "story";
}

export function jpDir(workDir: string): string {
  return join(workDir, ".jpvoice");
}

export function findWorkDir(start: string = process.cwd()): string {
  let dir = resolve(start);
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(dir, ".jpvoice", "project.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "No jpvoice project found here. Run `jpvoice init` first, or pass --dir <path>.",
  );
}

export function emptyBible(): Bible {
  return { entities: [], facts: [], threads: [], events: [], knowledge: [] };
}

export function initProject(
  workDir: string,
  meta: Omit<ProjectMeta, "createdAt" | "updatedAt">,
): Project {
  const dir = jpDir(workDir);
  for (const sub of ["", "scenes", "reports", "state", "patches"]) {
    mkdirSync(join(dir, sub), { recursive: true });
  }
  const now = new Date().toISOString();
  const project: Project = {
    meta: { ...meta, createdAt: now, updatedAt: now },
    plan: null,
    scenes: {},
    anchors: [],
    bible: emptyBible(),
  };
  saveProject(workDir, project);
  writeFileSync(join(dir, "anchors.md"), "# Voice anchors\n\nFrozen passages that hold the register. Approved by the author.\n\n", "utf8");
  writeFileSync(join(dir, "runs.jsonl"), "", "utf8");
  return project;
}

export function loadProject(workDir: string): Project {
  const path = join(jpDir(workDir), "project.json");
  if (!existsSync(path)) throw new Error(`Not a jpvoice project: ${workDir}`);
  return JSON.parse(readFileSync(path, "utf8")) as Project;
}

export function saveProject(workDir: string, project: Project): void {
  project.meta.updatedAt = new Date().toISOString();
  writeFileSync(join(jpDir(workDir), "project.json"), JSON.stringify(project, null, 2), "utf8");
}

export function scenePath(workDir: string, id: string): string {
  return join(jpDir(workDir), "scenes", `${id}.md`);
}

export function readScene(workDir: string, id: string): string | null {
  const path = scenePath(workDir, id);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

export function writeScene(workDir: string, id: string, body: string): void {
  writeFileSync(scenePath(workDir, id), body.trim() + "\n", "utf8");
}

export function syncScenes(project: Project): void {
  if (!project.plan) return;
  for (const ch of project.plan.chapters) {
    for (const scene of ch.scenes) {
      if (!project.scenes[scene.id]) {
        project.scenes[scene.id] = {
          id: scene.id,
          chapter: ch.number,
          beat: scene.beat,
          targetWords: scene.targetWords,
          words: 0,
          status: "pending",
          passes: 0,
        };
      } else {
        project.scenes[scene.id]!.beat = scene.beat;
        project.scenes[scene.id]!.targetWords = scene.targetWords;
      }
    }
  }
}

export function orderedScenes(project: Project): SceneState[] {
  return Object.values(project.scenes).sort((a, b) => {
    if (a.chapter !== b.chapter) return a.chapter - b.chapter;
    return a.id.localeCompare(b.id);
  });
}

export function compileManuscript(workDir: string, project: Project): string {
  if (!project.plan) throw new Error("No plan yet. Run `jpvoice plan`.");
  const parts: string[] = [];
  parts.push(`# ${project.meta.title}`);
  parts.push("");
  parts.push(
    `*Voice: ${project.meta.voiceKey} · ${project.meta.form} · target ${project.meta.words.toLocaleString()} words*`,
  );
  parts.push("");

  for (const ch of project.plan.chapters) {
    parts.push(`## ${ch.number}. ${ch.title}`);
    parts.push("");
    for (const scene of ch.scenes) {
      const body = readScene(workDir, scene.id);
      if (!body) continue;
      parts.push(body.trim());
      parts.push("");
    }
  }

  const text = parts.join("\n").replace(/\n{3,}/g, "\n\n");
  writeFileSync(join(workDir, "manuscript.md"), text, "utf8");
  return text;
}

export function wordsWritten(project: Project): number {
  return Object.values(project.scenes).reduce((sum, s) => sum + s.words, 0);
}

export function listReports(workDir: string): string[] {
  const dir = join(jpDir(workDir), "reports");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse();
}

export function reportPath(workDir: string, name: string): string {
  return join(jpDir(workDir), "reports", `${name}.md`);
}
