import { cleanScope, getDetail, parseRef } from "./api.js";
import { loadFields, loadModules, loadTables } from "./store.js";
import type { FieldRec, ParsedRef, TableMeta } from "./types.js";

export interface FieldRow {
  name: string;
  displayName: string;
  type: string;
  key: boolean;
  nullable: boolean;
  ref: ParsedRef;
  scope: string;
  help: string;
}

export function searchTables(keyword: string, moduleCode?: string, limit = 30): TableMeta[] {
  const kw = keyword.toLowerCase();
  const tables = loadTables();
  const hits: { t: TableMeta; score: number }[] = [];
  for (const t of tables) {
    if (moduleCode && t.moduleCode !== moduleCode && t.module !== moduleCode) continue;
    let score = -1;
    if (t.tableName.toLowerCase() === kw || t.id === keyword) score = 100;
    else if (t.tableName.toLowerCase().startsWith(kw)) score = 80;
    else if (t.displayName.toLowerCase().includes(kw)) score = 60;
    else if (t.fullClassname.toLowerCase().includes(kw)) score = 50;
    else if (t.tableName.toLowerCase().includes(kw)) score = 40;
    else if (t.module.toLowerCase().includes(kw)) score = 10;
    if (score >= 0) hits.push({ t, score });
  }
  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((h) => h.t);
}

export function resolveTable(nameOrId: string): TableMeta {
  const tables = loadTables();
  const q = nameOrId.toLowerCase();
  const exact =
    tables.find((t) => t.id === nameOrId) ??
    tables.find((t) => t.tableName.toLowerCase() === q) ??
    tables.find((t) => t.fullClassname.toLowerCase() === q) ??
    tables.find((t) => t.displayName === nameOrId);
  if (exact) return exact;
  const hits = searchTables(nameOrId, undefined, 5);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    const names = hits.map((t) => t.tableName).join(", ");
    throw new Error(`"${nameOrId}" 匹配到多张表: ${names}，请输入更精确的表名`);
  }
  throw new Error(`未找到表: ${nameOrId}（可先用 search 命令模糊查找）`);
}

export async function listFields(base: string | undefined, nameOrId: string): Promise<{ table: TableMeta; fields: FieldRow[] }> {
  const table = resolveTable(nameOrId);
  const detail = await getDetail(base, table.id);
  const fields = (detail.propertyVO ?? []).map((f) => ({
    name: f.name,
    displayName: f.displayName,
    type: f.dataTypeSql ?? "",
    key: Boolean(f.keyProp),
    nullable: Boolean(f.nullable),
    ref: parseRef(f.refClassPathHref as string | undefined),
    scope: cleanScope(f.dataScope as string | undefined),
    help: (f.help ?? "").trim(),
  }));
  return { table, fields };
}

export function searchField(name: string, limit = 50): FieldRec[] {
  const q = name.toLowerCase();
  const all = loadFields();
  const hits = all.filter((f) => f.n.toLowerCase() === q);
  if (hits.length) return hits.slice(0, limit);
  return all
    .filter((f) => f.n.toLowerCase().includes(q) || f.dn.toLowerCase().includes(q))
    .slice(0, limit);
}

// 同一物理表在字典中常有多个 VO 实体条目（如主子表、不同版本），按表名聚合展示
export interface FieldHitGroup {
  tableName: string;
  entries: FieldRec[];
}

export function groupFieldHits(hits: FieldRec[]): FieldHitGroup[] {
  const byName = new Map<string, FieldRec[]>();
  for (const f of hits) {
    const list = byName.get(f.tbl) ?? [];
    list.push(f);
    byName.set(f.tbl, list);
  }
  return [...byName.entries()].map(([tableName, entries]) => ({ tableName, entries }));
}

export function listModules(): { name: string; code: string; count: number }[] {
  return loadModules().sort((a, b) => b.count - a.count);
}

export function fieldRowToJson(f: FieldRow) {
  return {
    name: f.name,
    displayName: f.displayName,
    type: f.type,
    key: f.key,
    nullable: f.nullable,
    refId: f.ref.refId || undefined,
    refName: f.ref.refName || undefined,
    enum: f.scope || undefined,
    help: f.help || undefined,
  };
}
