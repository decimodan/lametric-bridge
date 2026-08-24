import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export const config = {
  awtrixBaseUrl: required("AWTRIX_BASE_URL", "http://192.168.50.98").replace(
    /\/$/,
    "",
  ),
  awtrixUser: optional("AWTRIX_USER"),
  awtrixPass: optional("AWTRIX_PASS"),
  bridgeHost: process.env.BRIDGE_HOST?.trim() || "0.0.0.0",
  bridgePort: Number(process.env.PORT ?? process.env.BRIDGE_PORT ?? 8787),
  bridgeToken: optional("BRIDGE_TOKEN"),
};
