import Fastify from "fastify";
import formbody from "@fastify/formbody";
import { registerApiRoutes } from "./api/routes.js";
import { registerPanelRoutes } from "./panel/routes.js";
import {
  startHomeAssistant,
  stopHomeAssistant,
} from "./adapters/homeAssistant.js";
import { config } from "./config.js";
import { closeDb, dbDisplay, initDb } from "./db/index.js";
import { startQueue } from "./services/queue.js";

async function main(): Promise<void> {
  await initDb();
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
    `lametric-bridge listening on :${config.port} (db=${dbDisplay()})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
