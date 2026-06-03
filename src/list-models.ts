import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";

/**
 * List available models in a table format.
 */
export async function listModels(): Promise<void> {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const models = modelRegistry.getAvailable();

  if (models.length === 0) {
    console.log("No models available. Set API keys in environment variables.");
    return;
  }

  // Sort by provider, then by model id
  const sorted = [...models].sort((a, b) => {
    const providerCmp = a.provider.localeCompare(b.provider);
    if (providerCmp !== 0) return providerCmp;
    return a.id.localeCompare(b.id);
  });

  // Build rows
  const rows = sorted.map((m) => ({
    provider: m.provider,
    model: m.id,
  }));

  const headers = { provider: "provider", model: "model" };

  // Calculate column widths
  const widths = {
    provider: Math.max(
      headers.provider.length,
      ...rows.map((r) => r.provider.length),
    ),
    model: Math.max(headers.model.length, ...rows.map((r) => r.model.length)),
  };

  // Print header
  console.log(
    `${headers.provider.padEnd(widths.provider)}  ${headers.model.padEnd(widths.model)}`,
  );

  // Print rows
  for (const row of rows) {
    console.log(
      `${row.provider.padEnd(widths.provider)}  ${row.model.padEnd(widths.model)}`,
    );
  }
}
