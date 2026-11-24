import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CONFIG_DIR = process.env.YONBIP_DEV_HOME ?? join(homedir(), ".config", "yonbip-dev");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface Profile {
  ncHome: string;
  front: string[];
  back: string[];
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

export function activeProfile(name?: string): { name: string; profile: Profile } {
  const cfg = loadConfig();
  if (!cfg || !Object.keys(cfg.profiles).length) {
    fail(
      "未配置开发环境。请先运行:\n" +
        "  yonbip-dev set --nc-home <NCHOME> --front <前端工程> --back <后端工程>"
    );
  }
  const n = name ?? cfg.active;
  const p = cfg.profiles[n];
  if (!p) fail(`profile "${n}" 不存在`);
  return { name: n, profile: p };
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
