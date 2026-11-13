import { createInterface, type Interface } from "node:readline/promises";

let rl: Interface | null = null;

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY);
}

function reader(): Interface {
  if (!rl) rl = createInterface({ input: process.stdin, output: process.stdout });
  return rl;
}

/**
 * One reader for the whole run. Creating a fresh interface per question
 * discards anything already buffered — which breaks paste-ahead and any
 * scripted stdin.
 */
export async function confirm(
  question: string,
  opts: { yes?: boolean; defaultYes?: boolean } = {},
): Promise<boolean> {
  if (opts.yes) return true;
  if (!process.stdin.isTTY) {
    throw new Error(
      "This run needs confirmation, but stdin is not a terminal. Pass --yes to run non-interactively.",
    );
  }

  const answer = (await reader().question(question)).trim().toLowerCase();
  if (answer === "") return opts.defaultYes ?? false;
  return answer === "y" || answer === "yes";
}

/** Close the reader so the process can exit. */
export function closePrompts(): void {
  if (rl) {
    rl.close();
    rl = null;
  }
}
