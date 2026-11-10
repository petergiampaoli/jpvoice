import type { FormSpec } from "../voice/schema.js";

export type ScenePlan = {
  id: string;
  beat: string;
  targetWords: number;
};

export type ChapterPlan = {
  number: number;
  title: string;
  function: string;
  targetWords: number;
  scenes: ScenePlan[];
};

export type StoryPlan = {
  title: string;
  logline: string;
  characters: Array<{ name: string; role: string; note: string }>;
  chapters: ChapterPlan[];
};

export type Structure = {
  chapters: Array<{ number: number; sceneCount: number; budgets: number[] }>;
  sceneBudgets: number[];
  totalScenes: number;
  totalWords: number;
};

export function allocate(total: number, count: number, min: number, max: number): number[] {
  if (count <= 0) return [];
  const target = Math.round(total);
  const base = Math.floor(target / count);
  const budgets = new Array<number>(count).fill(base);
  for (let i = 0; i < target - base * count; i++) budgets[i]! += 1;

  // When the average sits outside the nominal bounds, the nominal bounds
  // cannot all be satisfied. Widen them to the average and keep the total exact.
  const effMin = Math.min(min, base);
  const effMax = Math.max(max, base + 1);

  let sum = budgets.reduce((a, b) => a + b, 0);
  for (let i = 0; i < count; i++) {
    while (budgets[i]! < effMin) {
      budgets[i]! += 1;
      sum++;
    }
    while (budgets[i]! > effMax) {
      budgets[i]! -= 1;
      sum--;
    }
  }

  let guard = 0;
  while (sum !== target && guard++ < 100_000) {
    const step = target > sum ? 1 : -1;
    let idx = -1;
    for (let i = 0; i < count; i++) {
      const room = step > 0 ? effMax - budgets[i]! : budgets[i]! - effMin;
      if (room > 0) {
        idx = i;
        break;
      }
    }
    if (idx < 0) break;
    budgets[idx]! += step;
    sum += step;
  }

  return budgets;
}

export function structureFor(totalWords: number, form: FormSpec): Structure {
  const [sceneMin, sceneMax] = form.wordsPerScene;
  const targetScene = (sceneMin + sceneMax) / 2;
  const sceneCount = Math.max(1, Math.min(form.sceneCap, Math.round(totalWords / targetScene)));

  const chapters =
    totalWords <= 1500 ? 1 : Math.max(2, Math.min(18, Math.round(sceneCount / 3)));

  const budgets = allocate(totalWords, sceneCount, sceneMin, sceneMax);

  const perChapter = Math.ceil(sceneCount / chapters);
  const chapterPlans: Structure["chapters"] = [];
  let cursor = 0;
  for (let c = 0; c < chapters; c++) {
    const remainingChapters = chapters - c;
    const remainingScenes = sceneCount - cursor;
    const n = Math.max(1, Math.min(remainingScenes - (remainingChapters - 1), perChapter));
    const slice = budgets.slice(cursor, cursor + n);
    chapterPlans.push({ number: c + 1, sceneCount: slice.length, budgets: slice });
    cursor += n;
  }

  return {
    chapters: chapterPlans,
    sceneBudgets: budgets,
    totalScenes: sceneCount,
    totalWords,
  };
}

/** Force an LLM-proposed plan onto the deterministic structure and budget. */
export function reconcilePlan(raw: StoryPlan, structure: Structure, fallbackTitle: string): StoryPlan {
  const chapters: ChapterPlan[] = [];
  let budgetCursor = 0;
  let rawChapterIdx = 0;

  for (const sc of structure.chapters) {
    const proposed: ChapterPlan | undefined = raw.chapters[rawChapterIdx];
    rawChapterIdx++;

    const scenes: ScenePlan[] = [];
    for (let s = 0; s < sc.sceneCount; s++) {
      const proposedScene = proposed?.scenes?.[s];
      const budget = sc.budgets[s] ?? 1000;
      scenes.push({
        id: `ch${String(sc.number).padStart(2, "0")}-s${String(s + 1).padStart(2, "0")}`,
        beat:
          proposedScene?.beat?.trim() ||
          `Continue the story from the previous scene. Chapter function: ${proposed?.function ?? "accumulation"}.`,
        targetWords: budget,
      });
      budgetCursor++;
    }

    chapters.push({
      number: sc.number,
      title: proposed?.title?.trim() || `Chapter ${sc.number}`,
      function: proposed?.function?.trim() || "accumulation",
      targetWords: sc.budgets.reduce((a, b) => a + b, 0),
      scenes,
    });
  }

  void budgetCursor;

  return {
    title: raw.title?.trim() || fallbackTitle,
    logline: raw.logline?.trim() || "",
    characters: Array.isArray(raw.characters) ? raw.characters : [],
    chapters,
  };
}

export function totalPlannedWords(plan: StoryPlan): number {
  return plan.chapters.reduce(
    (sum, ch) => sum + ch.scenes.reduce((s, sc) => s + sc.targetWords, 0),
    0,
  );
}
