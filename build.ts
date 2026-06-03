import * as esbuild from "esbuild";
import { readFileSync } from "fs";

// Read version from pi-coding-agent's package.json
const piPkg = JSON.parse(
  readFileSync(
    "node_modules/@earendil-works/pi-coding-agent/package.json",
    "utf-8",
  ),
);

// Stub out the config module with just what we need
const configStub = `
export const isBunBinary = true;
export const isBunRuntime = true;
export const PACKAGE_NAME = "@earendil-works/pi-coding-agent";
export const VERSION = "${piPkg.version}";
export const APP_NAME = "pi";
export const APP_TITLE = "π";
export const CONFIG_DIR_NAME = ".pi";
export const ENV_AGENT_DIR = "PI_CODING_AGENT_DIR";
export const ENV_SESSION_DIR = "PI_CODING_AGENT_SESSION_DIR";

import { homedir } from "os";
import { join, dirname } from "path";

export function expandTildePath(path) {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return homedir() + path.slice(1);
  return path;
}

export function getAgentDir() {
  const envDir = process.env[ENV_AGENT_DIR];
  if (envDir) {
    return expandTildePath(envDir);
  }
  return join(homedir(), CONFIG_DIR_NAME, "agent");
}

export function detectInstallMethod() { return "bun-binary"; }
export function getSelfUpdateCommand() { return null; }
export function getSelfUpdateUnavailableInstruction() { return "Build from source"; }
export function getUpdateInstruction() { return "Build from source"; }
export function getPackageDir() { return dirname(process.execPath); }
export function getThemesDir() { return join(dirname(process.execPath), "theme"); }
export function getExportTemplateDir() { return join(dirname(process.execPath), "export-html"); }
export function getPackageJsonPath() { return join(dirname(process.execPath), "package.json"); }
export function getReadmePath() { return join(dirname(process.execPath), "README.md"); }
export function getDocsPath() { return join(dirname(process.execPath), "docs"); }
export function getExamplesPath() { return join(dirname(process.execPath), "examples"); }
export function getChangelogPath() { return join(dirname(process.execPath), "CHANGELOG.md"); }
export function getInteractiveAssetsDir() { return join(dirname(process.execPath), "assets"); }
export function getBundledInteractiveAssetPath(name) { return join(dirname(process.execPath), "assets", name); }
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

// Shim for node:worker_threads that adds markAsUncloneable (missing in Bun)
// undici@8.x imports it but it's only needed for structured-clone semantics.
// https://github.com/oven-sh/bun/issues/29423
const workerThreadsShim = `
import * as _originalWorkerThreads from "__original_worker_threads__";
const shim = { ..._originalWorkerThreads };
if (!shim.markAsUncloneable) {
  shim.markAsUncloneable = () => {};
}
export const markAsUncloneable = shim.markAsUncloneable;
export default shim;
// Re-export everything from the original module
export const Worker = _originalWorkerThreads.Worker;
export const isMainThread = _originalWorkerThreads.isMainThread;
export const parentPort = _originalWorkerThreads.parentPort;
export const workerData = _originalWorkerThreads.workerData;
export const threadId = _originalWorkerThreads.threadId;
export const MessageChannel = _originalWorkerThreads.MessageChannel;
export const MessagePort = _originalWorkerThreads.MessagePort;
export const BroadcastChannel = _originalWorkerThreads.BroadcastChannel;
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
      name: "shim-worker-threads",
      setup(build) {
        // Intercept node:worker_threads imports
        build.onResolve({ filter: /^node:worker_threads$/ }, () => ({
          path: "worker-threads-shim",
          namespace: "worker-threads-shim",
        }));
        // Resolve the placeholder back to the real module
        build.onResolve({ filter: /^__original_worker_threads__$/ }, () => ({
          path: "node:worker_threads",
          external: true,
        }));
        build.onLoad(
          { filter: /.*/, namespace: "worker-threads-shim" },
          () => ({
            contents: workerThreadsShim,
            loader: "ts",
          }),
        );
      },
    },
    {
      name: "stub-config",
      setup(build) {
        build.onResolve(
          { filter: /^@earendil-works\/pi-coding-agent\/dist\/config\.js$/ },
          () => ({ path: "config-stub", namespace: "stub" }),
        );
        build.onResolve({ filter: /\.\/config\.js$/ }, (args) => {
          if (args.importer.includes("pi-coding-agent")) {
            return { path: "config-stub", namespace: "stub" };
          }
          return null;
        });
        build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
          contents: configStub,
          loader: "ts",
        }));
      },
    },
  ],
});

console.log("Built build/cli.js");
