import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface BrowserDeviceStorage { read(): string | undefined; create(content: string): boolean }
/** Only the non-secret device id is persisted. Connection keys never enter this API. */
export function loadBrowserDeviceId(userData: string, storage: BrowserDeviceStorage = browserDeviceStorage(userData), uuid: () => string = randomUUID): string {
  const parse = (raw: string) => { if (Buffer.byteLength(raw) > 1024) throw Error("Invalid browser device identity"); let value: unknown; try { value = JSON.parse(raw); } catch { throw Error("Invalid browser device identity"); }
    if (!value || typeof value !== "object" || Object.keys(value).sort().join(",") !== "deviceId,version" || !("version" in value) || value.version !== 1 || !("deviceId" in value) || typeof value.deviceId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.deviceId)) throw Error("Invalid browser device identity"); return value.deviceId;
  };
  const existing = storage.read(); if (existing !== undefined) return parse(existing);
  const content = JSON.stringify({ version: 1, deviceId: uuid() }); const id = parse(content);
  if (storage.create(content)) return id;
  const winner = storage.read(); if (winner === undefined) throw Error("Browser device identity unavailable"); return parse(winner);
}
export function browserDeviceStorage(userData: string): BrowserDeviceStorage {
  const directory = resolve(userData), file = join(directory, "browser-device.json");
  const check = () => { for (let current = file; ; current = dirname(current)) { if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw Error("Linked browser device identity"); if (dirname(current) === current) break; } };
  return {
    read() { check(); if (!existsSync(file)) return undefined; const stat = lstatSync(file); if (!stat.isFile() || stat.size > 1024) throw Error("Invalid browser device identity"); return readFileSync(file, "utf8"); },
    create(content) { check(); mkdirSync(directory, { recursive: true }); try { writeFileSync(file, content, { flag: "wx", mode: 0o600 }); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw Error("Browser device identity write failed"); } },
  };
}
