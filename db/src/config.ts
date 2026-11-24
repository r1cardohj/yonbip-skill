import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CONFIG_DIR = process.env.YONBIP_DB_HOME ?? join(homedir(), ".config", "yonbip-db");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface Profile {
  driver: "mssql";
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
}

export interface Config {
  active: string;
  profiles: Record<string, Profile>;
}

export function configPath(): string {
  return CONFIG_FILE;
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

export function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

export function activeProfile(): Profile {
  const cfg = loadConfig();
  if (!cfg) {
    fail(
      "未配置数据库连接。请先运行:\n" +
        "  yonbip-db auth login --host <host> --port 1433 --database <库名> --user <用户> --password <密码>"
    );
  }
  const p = cfg.profiles[cfg.active];
  if (!p) fail(`当前 profile "${cfg.active}" 不存在`);
  return p;
}

export function updateProfile(name: string, patch: Partial<Profile>): void {
  const cfg = loadConfig() ?? { active: name, profiles: {} };
  cfg.profiles[name] = { ...cfg.profiles[name], ...patch } as Profile;
  cfg.active = name;
  saveConfig(cfg);
}

export function removeProfile(name: string): boolean {
  const cfg = loadConfig();
  if (!cfg || !cfg.profiles[name]) return false;
  delete cfg.profiles[name];
  if (cfg.active === name) cfg.active = Object.keys(cfg.profiles)[0] ?? "";
  saveConfig(cfg);
  return true;
}
