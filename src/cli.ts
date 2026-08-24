import { dismissNotification, getDevice, sendNotification, AwtrixError } from "./awtrix.ts";
import { config } from "./config.ts";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function positionalText(args: string[]): string {
  const parts: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const part = args[i];
    if (!part.startsWith("--")) {
      parts.push(part);
      continue;
    }
    if (part !== "--hold" && part !== "--no-wakeup" && part !== "--wakeup" && part !== "--help") {
      i += 1;
    }
  }
  return parts.join(" ").trim();
}

function fail(error: unknown): never {
  if (error instanceof AwtrixError) {
    console.error(`AWTRIX ${error.status}: ${error.message}`);
  } else if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
}

async function notify(text: string): Promise<void> {
  await sendNotification({
    text,
    textColor: argValue("--color") ?? "#3DFF9A",
    icon: argValue("--icon"),
    name: argValue("--name"),
    durationMs: argValue("--duration") ? Number(argValue("--duration")) : 6000,
    wakeup: !hasFlag("--no-wakeup"),
    hold: hasFlag("--hold"),
    soundRtttl: argValue("--rtttl"),
  });
  console.log(`Sent to ${config.awtrixBaseUrl}: ${text}`);
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;
  if (!command || command === "help" || command === "--help") {
    console.log(`Usage:
  npm run notify -- "Texto" [--color #3DFF9A] [--icon 1234] [--duration 6000] [--name job] [--hold] [--no-wakeup]
  npm run dismiss -- [nombre]
  npm run device
`);
    return;
  }

  try {
    if (command === "notify") {
      const text = positionalText(rest);
      if (!text) {
        throw new Error("Pass the notification text after notify");
      }
      await notify(text);
      return;
    }
    if (command === "dismiss") {
      await dismissNotification(rest[0]);
      console.log("Dismissed");
      return;
    }
    if (command === "device") {
      console.log(JSON.stringify(await getDevice(), null, 2));
      return;
    }
    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    fail(error);
  }
}

await main();
