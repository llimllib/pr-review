import { execFileSync } from "node:child_process";

/**
 * Information about what git diff is comparing
 */
export interface GitDiffContext {
  base: string; // Base commit SHA
  target: string; // Target commit SHA or special marker like "working tree"
  baseRef?: string; // Original ref name (e.g., "main", "HEAD~5")
  targetRef?: string; // Original ref name if not working tree
}

/**
 * Parse git diff arguments to determine what's being compared.
 * Handles common patterns like:
 * - git diff (working tree vs HEAD)
 * - git diff --cached (index vs HEAD)
 * - git diff commit (commit vs working tree)
 * - git diff commit1 commit2
 * - git diff commit1..commit2
 * - git diff commit1...commit2
 */
export function parseGitDiffArgs(
  args: string[],
  cwd: string,
): GitDiffContext | null {
  try {
    // Find -- separator if present
    const dashDashIndex = args.indexOf("--");

    // Only look at args before -- (pathspecs come after)
    const argsBeforePathspec =
      dashDashIndex >= 0 ? args.slice(0, dashDashIndex) : args;

    // Filter out options to find the commit refs
    // Skip options that take arguments (like --exclude, -e, -U)
    const nonOptions: string[] = [];
    for (let i = 0; i < argsBeforePathspec.length; i++) {
      const arg = argsBeforePathspec[i]!;
      // Skip flags that start with -
      if (arg.startsWith("-")) {
        // Check if it's a flag that takes an argument
        if (
          arg === "-e" ||
          arg === "--exclude" ||
          arg === "-U" ||
          arg === "--unified"
        ) {
          // Skip this flag and its argument
          i++;
        }
        // Otherwise just skip the flag itself
        continue;
      }
      // Skip exclude patterns
      if (arg.startsWith(":!")) {
        continue;
      }
      nonOptions.push(arg);
    }

    // Check for --cached/--staged flag
    const isCached = args.includes("--cached") || args.includes("--staged");

    if (nonOptions.length === 0) {
      // No commit args = working tree vs HEAD (or index vs HEAD if --cached)
      const base = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd,
        encoding: "utf-8",
      }).trim();
      return {
        base,
        target: isCached ? "index" : "working tree",
        baseRef: "HEAD",
      };
    }

    // Check for .. or ... syntax in a single argument
    const rangeArg = nonOptions[0];
    if (rangeArg) {
      // commit1...commit2 (three dots = merge-base)
      const threeDotMatch = rangeArg.match(/^(.+)\.\.\.(.+)$/);
      if (threeDotMatch) {
        const base = threeDotMatch[1]!;
        const target = threeDotMatch[2]!;
        const baseCommit = execFileSync("git", ["rev-parse", base], {
          cwd,
          encoding: "utf-8",
        }).trim();
        const targetCommit = execFileSync("git", ["rev-parse", target], {
          cwd,
          encoding: "utf-8",
        }).trim();
        return {
          base: baseCommit,
          target: targetCommit,
          baseRef: base,
          targetRef: target,
        };
      }

      // commit1..commit2 (two dots = range)
      const twoDotMatch = rangeArg.match(/^(.+)\.\.(.+)$/);
      if (twoDotMatch) {
        const base = twoDotMatch[1]!;
        const target = twoDotMatch[2]!;
        const baseCommit = execFileSync("git", ["rev-parse", base], {
          cwd,
          encoding: "utf-8",
        }).trim();
        const targetCommit = execFileSync("git", ["rev-parse", target], {
          cwd,
          encoding: "utf-8",
        }).trim();
        return {
          base: baseCommit,
          target: targetCommit,
          baseRef: base,
          targetRef: target,
        };
      }
    }

    // Single commit ref = commit vs working tree (or commit vs index if --cached)
    if (nonOptions.length === 1) {
      const ref = nonOptions[0]!;
      const baseCommit = execFileSync("git", ["rev-parse", ref], {
        cwd,
        encoding: "utf-8",
      }).trim();
      return {
        base: baseCommit,
        target: isCached ? "index" : "working tree",
        baseRef: ref,
      };
    }

    // Two commit refs = commit1 vs commit2
    if (nonOptions.length >= 2) {
      const baseRef = nonOptions[0]!;
      const targetRef = nonOptions[1]!;
      const baseCommit = execFileSync("git", ["rev-parse", baseRef], {
        cwd,
        encoding: "utf-8",
      }).trim();
      const targetCommit = execFileSync("git", ["rev-parse", targetRef], {
        cwd,
        encoding: "utf-8",
      }).trim();
      return {
        base: baseCommit,
        target: targetCommit,
        baseRef,
        targetRef,
      };
    }
  } catch (_err) {
    // If git commands fail, return null
    return null;
  }

  return null;
}

/**
 * Format git diff context for display
 */
export function formatGitDiffContext(context: GitDiffContext): string {
  const shortBase = context.base.substring(0, 7);
  const baseLabel = context.baseRef || shortBase;

  if (context.target === "working tree") {
    return `Reviewing changes: ${baseLabel} (${shortBase}) → working tree`;
  }

  if (context.target === "index") {
    return `Reviewing staged changes: ${baseLabel} (${shortBase}) → index`;
  }

  const shortTarget = context.target.substring(0, 7);
  const targetLabel = context.targetRef || shortTarget;
  return `Reviewing changes: ${baseLabel} (${shortBase}) → ${targetLabel} (${shortTarget})`;
}
