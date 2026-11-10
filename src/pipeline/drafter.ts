import { chat } from "../llm/client.js";
import { buildContext } from "./context.js";
import { cleanProse, countWordsSafe } from "./score.js";
import { rescaleText } from "./expand.js";
import type { Project } from "../store/project.js";
import { readScene, saveProject, writeScene } from "../store/project.js";
import type { EffectiveVoice } from "../voice/schema.js";
import { renderSceneContract, renderVoiceSpec } from "../voice/render.js";

const SYSTEM_PREFIX = `You are a literary novelist writing inside a fixed prose register. You produce prose only.

You never explain the story, never summarise, never address the reader, and never add headings, labels, or commentary. You do not begin with the character waking up. You do not end with a revelation.

# VOICE CONTRACT
`;

export async function draftScene(args: {
  workDir: string;
  project: Project;
  voice: EffectiveVoice;
  sceneId: string;
  temperature?: number;
  force?: boolean;
}): Promise<{ words: number; text: string; skipped: boolean }> {
  const { workDir, project, voice, sceneId } = args;
  const scene = project.scenes[sceneId];
  if (!scene) throw new Error(`Unknown scene: ${sceneId}`);

  if (!args.force) {
    const existing = readScene(workDir, sceneId);
    if (existing && countWordsSafe(existing) > 0) {
      return { words: countWordsSafe(existing), text: existing, skipped: true };
    }
  }

  const ctx = buildContext({
    workDir,
    project,
    scene,
    anchorTexts: project.anchors,
  });

  const userParts: string[] = [];
  userParts.push(
    renderSceneContract({
      words: scene.targetWords,
      tolerance: 0.1,
      beat: scene.beat,
      pov: voice.pov,
      tense: voice.tense,
    }),
  );

  if (project.meta.premise) {
    userParts.push(`# PREMISE\n${project.meta.premise}`);
  }
  if (ctx.characters) {
    userParts.push(`# CHARACTERS\n${ctx.characters}`);
  }
  if (ctx.bible) {
    userParts.push(`# CONTINUITY\n${ctx.bible}`);
  }
  if (ctx.previous) {
    userParts.push(
      `# IMMEDIATELY PRECEDING PROSE\nDo not repeat or paraphrase this. Continue from its final moment.\n\n${ctx.previous}`,
    );
  }
  if (ctx.anchors.length) {
    userParts.push(
      `# VOICE ANCHORS\nThese passages are in the target register. Match their cadence and their level of detail. Do not reuse their content.\n\n${ctx.anchors.join("\n\n---\n\n")}`,
    );
  }
  userParts.push(
    `# FINAL CONSTRAINT\nWrite approximately ${scene.targetWords} words. Do not exceed ${Math.round(scene.targetWords * 1.1)} words.`,
  );

  const res = await chat({
    messages: [
      { role: "system", content: SYSTEM_PREFIX + renderVoiceSpec(voice) },
      { role: "user", content: userParts.join("\n\n") },
    ],
    tier: "flash",
    temperature: args.temperature ?? 0.95,
    maxTokens: Math.min(8000, Math.round(scene.targetWords * 2.2) + 1800),
    tag: "draft",
  });

  const text = cleanProse(res.text);
  let words = countWordsSafe(text);

  // Scenes routinely come in 10-15% short. Correct once, using the register's
  // own expansion moves, rather than letting the budget drift across a book.
  const deviation = Math.abs(words - scene.targetWords) / Math.max(1, scene.targetWords);
  if (deviation > 0.12) {
    try {
      const fixed = await rescaleText({ text, voice, toWords: scene.targetWords, chunkWords: 700 });
      if (Math.abs(fixed.after - scene.targetWords) < Math.abs(words - scene.targetWords)) {
        writeScene(workDir, sceneId, fixed.text);
        scene.words = fixed.after;
        scene.status = "drafted";
        scene.passes = 0;
        scene.updatedAt = new Date().toISOString();
        saveProject(workDir, project);
        return { words: fixed.after, text: fixed.text, skipped: false };
      }
    } catch {
      /* keep the original draft if the correction fails */
    }
  }

  writeScene(workDir, sceneId, text);
  scene.words = words;
  scene.status = "drafted";
  scene.passes = 0;
  scene.updatedAt = new Date().toISOString();
  saveProject(workDir, project);

  return { words, text, skipped: false };
}

export async function draftAll(args: {
  workDir: string;
  project: Project;
  voice: EffectiveVoice;
  from?: string;
  to?: string;
  force?: boolean;
}): Promise<Array<{ id: string; words: number; skipped: boolean }>> {
  const ids = Object.values(args.project.scenes)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((s) => s.id)
    .filter((id) => (args.from ? id >= args.from : true))
    .filter((id) => (args.to ? id <= args.to : true));

  const out: Array<{ id: string; words: number; skipped: boolean }> = [];
  for (const id of ids) {
    const r = await draftScene({
      workDir: args.workDir,
      project: args.project,
      voice: args.voice,
      sceneId: id,
      force: args.force,
    });
    out.push({ id, words: r.words, skipped: r.skipped });
  }
  return out;
}
