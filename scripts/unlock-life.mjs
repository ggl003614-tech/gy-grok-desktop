/**
 * Emergency life-mode unlock used by Grok / CLI.
 * Leaves a marker so the GUI can scold and hold extra-high effort
 * until the user promises not to cheat again.
 *
 * Usage: node scripts/unlock-life.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const now = new Date();
const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
const localApp = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
const sqlitePath = join(appData, "dev.grokdesk.desktop", "grok-desk.sqlite3");
const levelPath = join(localApp, "dev.grokdesk.desktop", "EBWebView", "Default", "Local Storage", "leveldb");

const promise = {
  broken: true,
  source: "cli",
  scolded: false,
  xhighBlocked: true,
};
const cliUnlock = {
  at: now.toISOString(),
  untilWas: null,
  via: "grok",
};

function writeSqlite() {
  if (!existsSync(sqlitePath)) {
    console.warn("sqlite missing", sqlitePath);
    return;
  }
  const result = spawnSync(
    "python",
    [
      "-c",
      "import json,sqlite3,sys; p,payload,ts=sys.argv[1],sys.argv[2],int(sys.argv[3]); db=sqlite3.connect(p); db.execute('INSERT INTO settings(key, value_json, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at', ('life.integrity', payload, ts)); db.commit(); print('wrote life.integrity to sqlite')",
      sqlitePath,
      JSON.stringify(promise),
      String(Date.now()),
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "sqlite failed");
  if (result.stdout) process.stdout.write(result.stdout);
}

function encodeValue(json) {
  return Buffer.concat([Buffer.from([0x01]), Buffer.from(json, "utf8")]);
}

async function writeLocalStorage() {
  if (!existsSync(levelPath)) {
    console.warn("leveldb missing", levelPath);
    return;
  }
  let ClassicLevel;
  try {
    ({ ClassicLevel } = await import("classic-level"));
  } catch {
    const tmp = join(process.env.TEMP || "E:\\tmp", "unlock-life-mode");
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, "package.json"), '{"type":"module"}\n');
    const install = spawnSync("npm.cmd", ["install", "classic-level", "--no-fund", "--no-audit"], {
      cwd: tmp,
      stdio: "inherit",
      shell: true,
    });
    if (install.status !== 0) throw new Error("could not install classic-level");
    ({ ClassicLevel } = await import(pathToFileURL(join(tmp, "node_modules", "classic-level", "index.js")).href));
  }
  const db = new ClassicLevel(levelPath, { keyEncoding: "buffer", valueEncoding: "buffer" });
  const found = {};
  for await (const [key, value] of db.iterator()) {
    const name = key.toString("latin1");
    if (name.includes("life-mode.runtime") && !name.includes("META")) found.runtime = { key, value };
    if (name.includes("life-mode.config") && !name.includes("META")) found.config = { key, value };
    if (name.includes("life-mode.cli-unlock") && !name.includes("META")) found.cli = { key };
    if (name.includes("life-mode.promise") && !name.includes("META")) found.promise = { key };
    if (name.includes("life-mode.seal-shadow") && !name.includes("META")) found.shadow = { key, value };
  }
  if (found.runtime) {
    const bytes = found.runtime.value;
    const raw = bytes[0] === 1 ? bytes.subarray(1).toString("utf8") : bytes.toString("utf8");
    let runtime = {};
    try {
      runtime = JSON.parse(raw);
    } catch {
      runtime = {};
    }
    cliUnlock.untilWas = typeof runtime.lockedUntil === "string" ? runtime.lockedUntil : null;
    runtime.lockedUntil = null;
    runtime.lockReason = null;
    await db.put(found.runtime.key, encodeValue(JSON.stringify(runtime)));
  }
  const originPrefix = Buffer.from("_http://tauri.localhost\u0000\u0001", "latin1");
  const putNamed = async (suffix, json) => {
    const key = Buffer.concat([originPrefix, Buffer.from(suffix, "utf8")]);
    await db.put(key, encodeValue(json));
  };
  await putNamed("grok-desk.life-mode.cli-unlock", JSON.stringify(cliUnlock));
  await putNamed("grok-desk.life-mode.promise", JSON.stringify(promise));
  await db.close();
  console.log("wrote cli-unlock marker to localStorage");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    writeSqlite();
  } catch (error) {
    console.warn("sqlite write skipped:", error instanceof Error ? error.message : error);
  }
  writeLocalStorage().catch((error) => {
    console.warn("localStorage write skipped:", error instanceof Error ? error.message : error);
    process.exitCode = 0;
  });
}
