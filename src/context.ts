import { DefaultResourceLoader } from "@mariozechner/pi-coding-agent";

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
 */
export function processContextFiles(
	files: ContextFile[],
	maxBytes: number = MAX_CONTEXT_FILE_BYTES,
): ProcessedContext {
	const warnings: string[] = [];
	const processed = files.map(({ path: filePath, content }) => {
		if (content.length > maxBytes) {
			warnings.push(
				`Project context file ${filePath} is ${(content.length / 1024).toFixed(1)}KB, truncating to ${maxBytes / 1024}KB. Use --no-project-context to skip.`,
			);
			return {
				path: filePath,
				content: `${content.slice(0, maxBytes)}\n\n[... truncated, file was ${(content.length / 1024).toFixed(1)}KB ...]`,
			};
		}
		return { path: filePath, content };
	});
	return { files: processed, warnings };
}

/**
 * Discover and load project context files (AGENTS.md / CLAUDE.md) from the
 * project directory and its ancestors, using pi's DefaultResourceLoader.
 *
 * Files exceeding MAX_CONTEXT_FILE_BYTES are truncated with a warning on
 * stderr. Pass noProjectContext=true to skip discovery entirely.
 */
export async function loadProjectContext(
	cwd: string,
	noProjectContext: boolean,
): Promise<ContextFile[]> {
	if (noProjectContext) {
		return [];
	}

	// Use DefaultResourceLoader solely for its context file discovery.
	// Disable everything else to avoid unnecessary work.
	const loader = new DefaultResourceLoader({
		cwd,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
	});
	await loader.reload();

	const raw = loader.getAgentsFiles().agentsFiles;
	const { files, warnings } = processContextFiles(raw);

	for (const warning of warnings) {
		process.stderr.write(`\x1b[33m! ${warning}\x1b[0m\n`);
	}

	return files;
}
