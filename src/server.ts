import { serve } from "@hono/node-server";
import { app } from "./app.ts";
import { config } from "./config.ts";

serve({ fetch: app.fetch, hostname: config.bridgeHost, port: config.bridgePort }, (info) => {
  console.log(
    `LaMetric bridge listening on http://${info.address}:${info.port} → ${config.awtrixBaseUrl}`,
  );
});
