import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface RefApi {
  pk: string;
  name: string;
  path: string;
  verified: boolean;
}

export interface RefEntry {
  label: string;
  aliases: string[];
  refIds: string[];
  table?: string;
  pkField: string;
  codeField: string;
  nameField: string;
  api: RefApi | null;
  fixedBody?: Record<string, unknown>;
  note?: string;
}

export interface RefMapData {
  version: string;
  entries: Record<string, RefEntry>;
}

export interface RefRow {
  pk: string;
  code: string;
  name: string;
}

const BUILTIN_MAP = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "ref-map.json");
const USER_MAP = join(process.env.YONBIP_API_HOME ?? join(homedir(), ".config", "yonbip-api"), "ref-map.json");

/** 加载内置映射表，本地 ~/.config/yonbip-api/ref-map.json 与 extraFile 按条目字段级覆盖。 */
export function loadRefMap(extraFile?: string): RefMapData {
  const map = JSON.parse(readFileSync(BUILTIN_MAP, "utf8")) as RefMapData;
  for (const file of [USER_MAP, extraFile]) {
    if (!file || !existsSync(file)) continue;
    const over = JSON.parse(readFileSync(file, "utf8")) as Partial<RefMapData>;
    for (const [key, entry] of Object.entries(over.entries ?? {})) {
      map.entries[key] = map.entries[key] ? { ...map.entries[key], ...entry } : entry;
    }
  }
  return map;
}

/** 按类型名（键/别名）、表名、字典引用模型 id 定位档案条目。 */
export function resolveEntry(map: RefMapData, query: string): RefEntry | undefined {
  const q = query.toLowerCase();
  const entries = Object.values(map.entries);
  return (
    map.entries[q] ??
    entries.find((e) => e.table?.toLowerCase() === q) ??
    entries.find((e) => e.aliases.some((a) => a.toLowerCase() === q)) ??
    entries.find((e) => e.refIds.includes(query))
  );
}

export function resolveEntryByRefId(map: RefMapData, refId: string): RefEntry | undefined {
  return Object.values(map.entries).find((e) => e.refIds.includes(refId));
}

export function buildBody(entry: RefEntry, opts: { keyword?: string; code?: string; limit: number }): Record<string, unknown> {
  const body: Record<string, unknown> = { ...(entry.fixedBody ?? {}) };
  if (opts.code) body.code = opts.code;
  else if (opts.keyword) body.name = opts.keyword;
  body.page = { pageIndex: 0, pageSize: opts.limit };
  return body;
}

// NC Cloud openapi 查询接口常见返回结构：{ data: { rows|list|datas: [...] } } 或直接数组
function findArray(node: unknown, depth = 0): unknown[] | null {
  if (depth > 4 || !node || typeof node !== "object") return null;
  if (Array.isArray(node)) return node.length ? node : null;
  for (const key of ["rows", "list", "datas", "data", "result", "recordlist"]) {
    const v = (node as Record<string, unknown>)[key];
    if (Array.isArray(v) && v.length) return v;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const nested = findArray(v, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

function pick(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && String(v) !== "") return String(v);
  }
  return "";
}

export interface ExtractResult {
  rows: RefRow[];
  total: number;
  /** null=未给关键词；true=关键词匹配到；false=关键词无匹配（rows 为未过滤结果） */
  matched: boolean | null;
}

export function extractRows(body: unknown, entry: RefEntry, keyword?: string): ExtractResult {
  const raw = findArray(body) ?? [];
  const rows: RefRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    rows.push({
      pk: pick(row, entry.pkField, "pk", "refpk", "id"),
      code: pick(row, entry.codeField, "code", "refcode"),
      name: pick(row, entry.nameField, "name", "refname"),
    });
  }
  if (!keyword) return { rows, total: rows.length, matched: null };
  const q = keyword.toLowerCase();
  const hit = rows.filter((r) => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q));
  if (hit.length) return { rows: hit, total: rows.length, matched: true };
  return { rows, total: rows.length, matched: false };
}

export function formatRows(entry: RefEntry, result: ExtractResult): string {
  const lines = result.rows.map((r) => `  ${r.pk}\t${r.code}\t${r.name}`);
  const note =
    result.matched === true && result.total > result.rows.length
      ? `\n（接口返回 ${result.total} 条，关键词过滤后 ${result.rows.length} 条；调大 --limit 或用 --code 精确查）`
      : result.matched === false && result.rows.length
        ? `\n（关键词在返回字段中无匹配，以上为未过滤结果；可能字段名不同或接口不支持名称模糊，请核对原始返回）`
        : "";
  return `# ${entry.label}\n${lines.join("\n") || "  无结果"}${note}`;
}
