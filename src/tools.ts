/**
 * Sandboxed read-only tools that prevent path traversal above the working directory.
 *
 * Wraps pi's built-in read-only tools (read, grep, find, ls) to ensure agents
 * cannot access files outside the project directory — e.g. ~/.ssh when run in
 * ~/code/project_dir.
 */

import * as path from "node:path";
import { createReadOnlyTools } from "@mariozechner/pi-coding-agent";

type Tool = ReturnType<typeof createReadOnlyTools>[number];

/**
 * Check whether a resolved absolute path is within the allowed root directory.
 *
 * Note: this checks logical path containment only. It does not resolve symlinks,
 * so a symlink inside the project pointing outside (e.g. link -> /etc/passwd)
 * would pass validation. This is acceptable because the threat model is
 * preventing the LLM agent from requesting paths outside the project via
 * "../" or "~", not defending against a malicious project with planted symlinks.
 */
function isWithinRoot(resolvedPath: string, root: string): boolean {
  const normalizedPath = path.normalize(resolvedPath);
  const normalizedRoot = path.normalize(root);
  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}${path.sep}`)
  );
}

/**
 * Resolve a user-supplied path the same way pi's tools do:
 * expand ~ and resolve relative to cwd.
 */
function resolveUserPath(userPath: string, cwd: string): string {
  // Strip leading @ (pi convention for file references)
  let p = userPath.startsWith("@") ? userPath.slice(1) : userPath;

  // Expand ~ prefix
  if (p === "~" || p.startsWith("~/")) {
    const home = process.env.HOME ?? process.env.USERPROFILE;
    if (!home) {
      throw new Error(
        "Cannot resolve ~ in path: neither HOME nor USERPROFILE is set",
      );
    }
    p = p === "~" ? home : path.join(home, p.slice(2));
  }

  // Resolve relative paths against cwd
  if (!path.isAbsolute(p)) {
    p = path.resolve(cwd, p);
  }

  return path.normalize(p);
}

// Tools that have a `path` parameter we need to validate.
const TOOLS_WITH_PATH = new Set(["read", "grep", "find", "ls"]);

/**
 * Create read-only tools that are sandboxed to `cwd`.
 *
 * Any path argument that resolves outside `cwd` will be rejected with
 * a clear error message instead of allowing the file access.
 */
export function createSandboxedReadOnlyTools(cwd: string): Tool[] {
  const realCwd = path.resolve(cwd);
  const tools = createReadOnlyTools(realCwd);

  return tools.map((tool) => {
    if (!TOOLS_WITH_PATH.has(tool.name)) {
      return tool;
    }

    return {
      ...tool,
      execute: async (
        toolCallId: string,
        params: Record<string, unknown>,
        signal?: AbortSignal,
        onUpdate?: unknown,
      ) => {
        // Validate the `path` parameter if present
        const userPath = params.path as string | undefined;
        if (userPath != null && userPath !== "") {
          const resolved = resolveUserPath(userPath, realCwd);
          if (!isWithinRoot(resolved, realCwd)) {
            throw new Error(
              `Access denied: path "${userPath}" resolves to "${resolved}" which is outside the allowed directory "${realCwd}"`,
            );
          }
        }

        // Delegate to the real tool
        // biome-ignore lint/complexity/noBannedTypes: wrapping an opaque tool execute signature
        return (tool.execute as Function)(toolCallId, params, signal, onUpdate);
      },
    } as Tool;
  });
}
