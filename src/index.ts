import Fastify from "fastify";
import formbody from "@fastify/formbody";
import { registerApiRoutes } from "./api/routes.js";
import { registerPanelRoutes } from "./panel/routes.js";
import {
  startHomeAssistant,
  stopHomeAssistant,
} from "./adapters/homeAssistant.js";
import { PRODUCT_SLUG } from "./brand.js";
import { config } from "./config.js";
import { closeDb, dbDisplay, initDb } from "./db/index.js";
import { syncEnvDevices, refreshAllDeviceHosts } from "./services/devices.js";
import { startQueue } from "./services/queue.js";

async function main(): Promise<void> {
  await initDb();
  await syncEnvDevices();
  await refreshAllDeviceHosts().catch((err) => {
    console.warn("Initial MAC host refresh failed:", err);
  });
  setInterval(() => {
    refreshAllDeviceHosts().catch((err) => {
      console.warn("Periodic MAC host refresh failed:", err);
    });
  }, 5 * 60_000);
  startQueue();
  startHomeAssistant();

  const app = Fastify({
    logger: true,
  });

  await app.register(formbody);
  await registerApiRoutes(app);
  await registerPanelRoutes(app);

  const shutdown = async () => {
    stopHomeAssistant();
    await app.close();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info(
    `${PRODUCT_SLUG} listening on :${config.port} (db=${dbDisplay()})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
