import * as os from "node:os";
import * as path from "node:path";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

// Maximum size (in bytes) of project context files to include.
// Files larger than this are truncated and a warning is emitted.
export const MAX_CONTEXT_FILE_BYTES = 8 * 1024; // 8 KB

export interface ContextFile {
  path: string;
  content: string;
}

export interface ProcessedContext {
  files: ContextFile[];
  warnings: string[];
}

/**
 * Process context files: truncate any that exceed the size limit.
 * Returns the processed files and any warning messages (pure function).
 * The truncated output (including marker) will fit within maxBytes.
 */
export function processContextFiles(
  files: ContextFile[],
  maxBytes: number = MAX_CONTEXT_FILE_BYTES,
): ProcessedContext {
  const warnings: string[] = [];
  const processed = files.map(({ path: filePath, content }) => {
    if (content.length > maxBytes) {
      const marker = `\n\n[... truncated, file was ${(content.length / 1024).toFixed(1)}KB ...]`;
      const keepBytes = Math.max(0, maxBytes - marker.length);
      warnings.push(
        `Project context file ${filePath} is ${(content.length / 1024).toFixed(1)}KB, truncating to ${maxBytes / 1024}KB. Use --no-project-context to skip.`,
      );
      return {
        path: filePath,
        content: content.slice(0, keepBytes) + marker,
      };
    }
    return { path: filePath, content };
  });
  return { files: processed, warnings };
}

export interface LoadProjectContextResult {
  files: ContextFile[];
  warnings: string[];
}

/**
 * Discover and load project context files (AGENTS.md / CLAUDE.md) from the
 * project directory and its ancestors, using pi's DefaultResourceLoader.
 *
 * Files exceeding MAX_CONTEXT_FILE_BYTES are truncated. Warnings are returned
 * (not written to stderr) so the caller can display them at the right time.
 * Pass noProjectContext=true to skip discovery entirely.
 */
export async function loadProjectContext(
  cwd: string,
  noProjectContext: boolean,
): Promise<LoadProjectContextResult> {
  if (noProjectContext) {
    return { files: [], warnings: [] };
  }

  // Use DefaultResourceLoader solely for its context file discovery.
  // Disable everything else to avoid unnecessary work.
  const agentDir =
    process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
  });
  await loader.reload();

  const raw = loader.getAgentsFiles().agentsFiles;
  return processContextFiles(raw);
}
