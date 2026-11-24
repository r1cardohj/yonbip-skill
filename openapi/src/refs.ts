import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadApiDoc } from "./catalog.ts";

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
  /** 请求体里编码/名称/组织/集团的字段名，缺省 code/name/pk_org/pk_group */
  codeParam?: string;
  nameParam?: string;
  orgParam?: string;
  groupParam?: string;
  /** true 表示该接口的 pk_org 实际要填组织编码而非主键 */
  orgAsCode?: boolean;
  /** true 表示该接口没有分页参数，传 pageInfo 会报错 */
  noPaging?: boolean;
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

// 档案查询接口的请求体以 OPM 的请求示例为模板（data/api-docs.json）：
// 多数接口形如 { ufinterface: { sender, data: { 条件..., pageInfo } } }，也有直接把条件放顶层的，
// 且 pageInfo 有些接口放在 ufinterface 层而不是 data 层，所以按示例原位置回写。
// 没抓到示例时用通用 ufinterface 结构兜底。
function pickData(body: Record<string, unknown>): { data: Record<string, unknown>; host: Record<string, unknown> } {
  const uf = body.ufinterface as Record<string, unknown> | undefined;
  if (uf && typeof uf === "object" && !Array.isArray(uf)) {
    if (!uf.sender) uf.sender = "default";
    if (!uf.data || typeof uf.data !== "object" || Array.isArray(uf.data)) uf.data = {};
    return { data: uf.data as Record<string, unknown>, host: uf };
  }
  if (Object.keys(body).length) return { data: body, host: body };
  const wrapped = { sender: "default", data: {} as Record<string, unknown> };
  body.ufinterface = wrapped;
  return { data: wrapped.data, host: wrapped };
}

export interface BuildOpts {
  keyword?: string;
  code?: string;
  org?: string;
  group?: string;
  limit: number;
}

export function buildBody(entry: RefEntry, opts: BuildOpts): Record<string, unknown> {
  let body: Record<string, unknown> = {};
  const example = entry.api ? loadApiDoc(entry.api.pk)?.requestExample : null;
  if (example) {
    try {
      body = JSON.parse(example) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }

  const { data, host } = pickData(body);
  const seesPlaceholderGroup = data.pk_group === "1";

  Object.assign(data, entry.fixedBody ?? {});
  const codeParam = entry.codeParam ?? "code";
  const nameParam = entry.nameParam ?? "name";
  if (opts.code) data[codeParam] = [opts.code];
  else if (opts.keyword) data[nameParam] = [opts.keyword];
  if (opts.org) data[entry.orgParam ?? "pk_org"] = [opts.org];  if (opts.group) data[entry.groupParam ?? "pk_group"] = opts.group;
  else if (seesPlaceholderGroup) data.pk_group = null;

  if (entry.noPaging) return body;
  const pageInfo = { pageIndex: "0", pageSize: String(opts.limit) };
  const exampleHasPaging = example ? /"pageInfo"/.test(example) : true;
  // 有些接口根本没有分页参数，传了反而报错，所以只在示例里出现过分页时才回写
  if (!exampleHasPaging) return body;
  if ("pageInfo" in host && !("pageInfo" in data)) host.pageInfo = pageInfo;
  else data.pageInfo = pageInfo;
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
    let row = item as Record<string, unknown>;
    // 有些接口把单据包在单键对象里，如 { "uapbd.project": { ...字段 } }
    const keys = Object.keys(row);
    if (keys.length === 1 && row[keys[0]] && typeof row[keys[0]] === "object" && !Array.isArray(row[keys[0]])) {
      row = row[keys[0]] as Record<string, unknown>;
    }
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
