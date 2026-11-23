import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CONFIG_DIR = process.env.YONBIP_API_HOME ?? join(homedir(), ".config", "yonbip-api");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface Profile {
  gateway: string;
  appId: string;
  appSecret: string;
  pubKey: string;
  bizCenter: string;
  securityKey?: string;
  token?: { value: string; expiresAt: number };
}

export interface Config {
  active: string;
  profiles: Record<string, Profile>;
}

export function loadConfig(): Config | null {
  if (!existsSync(CONFIG_FILE)) return null;
  return JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as Config;
}

export function saveConfig(cfg: Config): void {
  mkdirSync(dirname(CONFIG_FILE), { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  chmodSync(CONFIG_FILE, 0o600);
}

export function activeProfile(): Profile {
  const cfg = loadConfig();
  if (!cfg) {
    fail("未登录。请先运行: yonbip-api auth login --gateway <url> --app-id <id> --app-secret <s> --pub-key <k> --biz-center <c>");
  }
  const p = cfg.profiles[cfg.active];
  if (!p) fail(`当前 profile "${cfg.active}" 不存在`);
  return p;
}

export function updateProfile(name: string, patch: Partial<Profile>): void {
  const cfg = loadConfig() ?? { active: name, profiles: {} };
  cfg.profiles[name] = { ...cfg.profiles[name], ...patch };
  cfg.active = name;
  saveConfig(cfg);
}

export function removeProfile(name: string): boolean {
  const cfg = loadConfig();
  if (!cfg?.profiles[name]) return false;
  delete cfg.profiles[name];
  if (cfg.active === name) cfg.active = Object.keys(cfg.profiles)[0] ?? "";
  saveConfig(cfg);
  return true;
}

export function configPath(): string {
  return CONFIG_FILE;
}

export function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}
