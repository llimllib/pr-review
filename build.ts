import * as esbuild from "esbuild";
import { readFileSync } from "fs";

// Read version from pi-coding-agent's package.json
const piPkg = JSON.parse(
	readFileSync("node_modules/@mariozechner/pi-coding-agent/package.json", "utf-8")
);

// Stub out the config module with just what we need
const configStub = `
export const isBunBinary = true;
export const isBunRuntime = true;
export const VERSION = "${piPkg.version}";
export const APP_NAME = "pi";
export const CONFIG_DIR_NAME = ".pi";
export const ENV_AGENT_DIR = "PI_CODING_AGENT_DIR";

import { homedir } from "os";
import { join, dirname } from "path";

export function getAgentDir() {
  const envDir = process.env[ENV_AGENT_DIR];
  if (envDir) {
    if (envDir === "~") return homedir();
    if (envDir.startsWith("~/")) return homedir() + envDir.slice(1);
    return envDir;
  }
  return join(homedir(), CONFIG_DIR_NAME, "agent");
}

export function detectInstallMethod() { return "bun-binary"; }
export function getUpdateInstruction() { return "Build from source"; }
export function getPackageDir() { return dirname(process.execPath); }
export function getThemesDir() { return join(dirname(process.execPath), "theme"); }
export function getExportTemplateDir() { return join(dirname(process.execPath), "export-html"); }
export function getPackageJsonPath() { return join(dirname(process.execPath), "package.json"); }
export function getReadmePath() { return join(dirname(process.execPath), "README.md"); }
export function getDocsPath() { return join(dirname(process.execPath), "docs"); }
export function getExamplesPath() { return join(dirname(process.execPath), "examples"); }
export function getChangelogPath() { return join(dirname(process.execPath), "CHANGELOG.md"); }
export function getShareViewerUrl(gistId) { return "https://pi.dev/session/#" + gistId; }
export function getCustomThemesDir() { return join(getAgentDir(), "themes"); }
export function getModelsPath() { return join(getAgentDir(), "models.json"); }
export function getAuthPath() { return join(getAgentDir(), "auth.json"); }
export function getSettingsPath() { return join(getAgentDir(), "settings.json"); }
export function getToolsDir() { return join(getAgentDir(), "tools"); }
export function getBinDir() { return join(getAgentDir(), "bin"); }
export function getPromptsDir() { return join(getAgentDir(), "prompts"); }
export function getSessionsDir() { return join(getAgentDir(), "sessions"); }
export function getDebugLogPath() { return join(getAgentDir(), "pi-debug.log"); }
`;

await esbuild.build({
	entryPoints: ["src/cli.ts"],
	bundle: true,
	platform: "node",
	target: "node20",
	format: "esm",
	outfile: "build/cli.js",
	plugins: [
		{
			name: "stub-config",
			setup(build) {
				build.onResolve(
					{ filter: /^@mariozechner\/pi-coding-agent\/dist\/config\.js$/ },
					() => ({ path: "config-stub", namespace: "stub" })
				);
				build.onResolve(
					{ filter: /\.\/config\.js$/ },
					(args) => {
						if (args.importer.includes("pi-coding-agent")) {
							return { path: "config-stub", namespace: "stub" };
						}
						return null;
					}
				);
				build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
					contents: configStub,
					loader: "ts",
				}));
			},
		},
	],
});

console.log("Built build/cli.js");
