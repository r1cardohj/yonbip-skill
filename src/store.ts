import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FieldRec, TableMeta } from "./types.js";

// 数据字典随 skill 打包（data/ 与 dist/ 同级）；可用 YONBIP_DICT_HOME 覆盖
const BUNDLED_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const BASE_DIR =
  process.env.YONBIP_DICT_HOME ??
  (existsSync(BUNDLED_DIR) ? BUNDLED_DIR : join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "yonbip-dict"));

export const paths = {
  base: BASE_DIR,
  indexJson: join(BASE_DIR, "index.json"),
  tablesJsonl: join(BASE_DIR, "tables.jsonl"),
  fieldsJsonl: join(BASE_DIR, "fields.jsonl"),
  modulesJson: join(BASE_DIR, "modules.json"),
  detailsDir: join(BASE_DIR, "details"),
  detailFile: (id: string) => join(BASE_DIR, "details", `${id}.json`),
};

export function ensureBase(): void {
  mkdirSync(paths.detailsDir, { recursive: true });
}

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

export function writeJson(file: string, data: unknown): void {
  writeFileSync(file, JSON.stringify(data));
}

export function writeJsonl(file: string, rows: unknown[]): void {
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

export function readJsonl<T>(file: string): T[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

export function loadTables(): TableMeta[] {
  if (!existsSync(paths.tablesJsonl)) {
    fail(`未找到本地索引: ${paths.tablesJsonl}\n请先运行: yonbip-dict sync`);
  }
  return readJsonl<TableMeta>(paths.tablesJsonl);
}

export function loadFields(): FieldRec[] {
  if (!existsSync(paths.fieldsJsonl)) {
    fail(`未找到字段索引: ${paths.fieldsJsonl}\n请先运行: yonbip-dict sync --fields`);
  }
  return readJsonl<FieldRec>(paths.fieldsJsonl);
}

export function loadModules(): { name: string; code: string; count: number }[] {
  if (!existsSync(paths.modulesJson)) {
    fail(`未找到模块索引: ${paths.modulesJson}\n请先运行: yonbip-dict sync`);
  }
  return readJson<{ name: string; code: string; count: number }[]>(paths.modulesJson);
}

export function detailCount(): number {
  if (!existsSync(paths.detailsDir)) return 0;
  return readdirSync(paths.detailsDir).filter((f) => f.endsWith(".json")).length;
}

export function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

export function baseUrl(cliBase?: string): string {
  const base = cliBase ?? process.env.YONBIP_DICT_BASE;
  if (!base) {
    fail("未指定数据源地址，请通过 --base <url> 或环境变量 YONBIP_DICT_BASE 传入 dict-browser 服务地址");
  }
  return base.replace(/\/$/, "");
}

// detail 接口路径由前端 app.js 中的 detailPattern 决定：../yonbip3ddcr5-json/{id}.json
export function detailUrl(base: string, id: string): string {
  return `${base}/yonbip3ddcr5-json/${id}.json`;
}

export function indexUrl(base: string): string {
  return `${base}/dict-browser/data/index.json`;
}

export function shortHash(s: string): string {
  return createHash("md5").update(s).digest("hex").slice(0, 8);
}

export function cacheSize(): number {
  let total = 0;
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      const st = statSync(p);
      total += st.isDirectory() ? 0 : st.size;
      if (st.isDirectory()) walk(p);
    }
  };
  walk(BASE_DIR);
  return total;
}
