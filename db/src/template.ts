import { existsSync, mkdirSync, openSync, closeSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runQuery, type QueryResult } from "./client.ts";

// 字典数据（yonbip-dict 的 fields.jsonl）用来给模板字段补中文名；
// 缺失或是 LFS 指针时静默跳过，只影响显示名，不影响功能。
const SKILL_DATA =
  process.env.YONBIP_DICT_HOME ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");

function isLfsPointer(file: string): boolean {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(64);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).toString("utf8").startsWith("version https://git-lfs");
  } finally {
    closeSync(fd);
  }
}

// key: 物理表名.字段名 → 中文名，如 bd_psndoc.email → 电子邮箱
// fields.jsonl 有 64MB/51 万行，每次调用重建要 3 秒，所以按源文件 mtime 缓存一份 TSV
let nameIndex: Map<string, string> | null | undefined;

const CACHE_DIR = join(process.env.XDG_CACHE_HOME ?? join(process.env.HOME ?? "/tmp", ".cache"), "yonbip-db");

function loadNameIndex(): Map<string, string> | null {
  if (nameIndex !== undefined) return nameIndex;
  const file = join(SKILL_DATA, "fields.jsonl");
  if (!existsSync(file) || isLfsPointer(file)) {
    nameIndex = null;
    return null;
  }
  const st = statSync(file);
  const stamp = `${st.size}:${st.mtimeMs}`;
  const cacheFile = join(CACHE_DIR, "field-names.tsv");
  const stampFile = join(CACHE_DIR, "field-names.stamp");
  if (existsSync(cacheFile) && existsSync(stampFile) && readFileSync(stampFile, "utf8") === stamp) {
    const map = new Map<string, string>();
    for (const line of readFileSync(cacheFile, "utf8").split("\n")) {
      if (!line) continue;
      const tab = line.indexOf("\t");
      if (tab > 0) map.set(line.slice(0, tab), line.slice(tab + 1));
    }
    nameIndex = map;
    return map;
  }
  const map = new Map<string, string>();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    try {
      const d = JSON.parse(line) as { tbl?: string; n?: string; dn?: string };
      if (d.tbl && d.n && d.dn) map.set(`${d.tbl}.${d.n}`, d.dn);
    } catch {
      // 跳过坏行
    }
  }
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cacheFile, [...map].map(([k, v]) => `${k}\t${v}`).join("\n"));
    writeFileSync(stampFile, stamp);
  } catch {
    // 缓存写失败不影响主流程
  }
  nameIndex = map;
  return map;
}

// NC 体系里的用户自定义/扩展字段：自定义项 def1-30、defitemN、自由项 zyx1-30、userdef*
const CUSTOM_FIELD = /^(v?def\d+|defitem\d+|zyx\d+|userdef\w*)$/i;

function rowsOf(result: QueryResult): Record<string, unknown>[] {
  return result.rows.map((r) => Object.fromEntries(result.columns.map((c, i) => [c, r[i]])));
}

export interface TemplateOptions {
  keyword: string;
  node?: string;
  meta?: string;
  json: boolean;
  limit: number;
}

export async function queryTemplates(opts: TemplateOptions): Promise<void> {
  const kw = opts.keyword.replace(/'/g, "''");
  const headSql = `
    SELECT pk_billtemplet, bill_templetname, bill_templetcaption, pk_billtypecode,
           nodecode, metadataclass, model_type, layer, pk_corp
    FROM pub_billtemplet
    WHERE dr = 0 AND (
      pk_billtypecode LIKE '%${kw}%' OR bill_templetname LIKE '%${kw}%'
      OR bill_templetcaption LIKE '%${kw}%' OR metadataclass LIKE '%${kw}%'
      OR pk_billtemplet = '${kw}'
    )
    ORDER BY pk_billtypecode, nodecode`;
  const heads = rowsOf(await runQuery(headSql, 30000));
  if (!heads.length) {
    throw new Error(`没有匹配 "${opts.keyword}" 的模板（pub_billtemplet 按单据类型/模板名/实体名模糊匹配）`);
  }

  const pks = heads.map((h) => String(h.pk_billtemplet).replace(/'/g, "''"));
  const fieldSql = `
    SELECT b.pk_billtemplet, b.itemkey, b.defaultshowname, b.metadataproperty, b.resid,
           b.editflag, b.cardflag, b.listshowflag, b.nullflag, b.leafflag, b.reftype, b.pos,
           b.itemtype, b.defaultvalue
    FROM pub_billtemplet_b b
    WHERE b.dr = 0 AND b.pk_billtemplet IN ('${pks.join("','")}')
    ORDER BY b.pk_billtemplet, b.pos`;
  const fields = rowsOf(await runQuery(fieldSql, 60000));

  const byHead = new Map<string, Record<string, unknown>[]>();
  for (const f of fields) {
    const list = byHead.get(String(f.pk_billtemplet)) ?? [];
    list.push(f);
    byHead.set(String(f.pk_billtemplet), list);
  }

  const names = loadNameIndex();
  const resolveName = (f: Record<string, unknown>): string => {
    const showname = f.defaultshowname ? String(f.defaultshowname).trim() : "";
    if (showname) return showname;
    const mp = String(f.metadataproperty ?? "");
    const parts = mp.split(".");
    if (parts.length >= 2 && names) {
      const dn = names.get(`${parts[parts.length - 2]}.${parts[parts.length - 1]}`);
      if (dn) return dn;
    }
    return "";
  };

  const shown = heads.slice(0, opts.limit);
  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          matched: heads.length,
          shown: shown.length,
          templates: shown.map((h) => ({
            ...h,
            fields: (byHead.get(String(h.pk_billtemplet)) ?? []).map((f) => ({
              itemkey: f.itemkey,
              name: resolveName(f),
              custom: CUSTOM_FIELD.test(String(f.itemkey)),
              editable: f.editflag === 1,
              card: f.cardflag === 1,
              list: f.listshowflag === "Y",
              required: f.nullflag === 1,
              ref: f.reftype ?? null,
              default: f.defaultvalue ?? null,
            })),
          })),
        },
        null,
        2
      )
    );
    return;
  }

  for (const h of shown) {
    const tfields = byHead.get(String(h.pk_billtemplet)) ?? [];
    console.log(`# ${h.bill_templetcaption || h.bill_templetname}  (${h.pk_billtypecode})`);
    console.log(
      `  模板: ${h.pk_billtemplet}  节点: ${h.nodecode ?? "-"}  实体: ${h.metadataclass ?? "-"}  账套: ${h.pk_corp ?? "-"}`
    );
    console.log("  标志: E=可编辑 C=卡片显示 L=列表显示 !=必填  [自定义]=用户自定义项");
    console.log("  字段                    名称                 标志   参照/默认值");
    for (const f of tfields) {
      const key = String(f.itemkey);
      const flags =
        `${f.editflag === 1 ? "E" : "-"}${f.cardflag === 1 ? "C" : "-"}${f.listshowflag === "Y" ? "L" : "-"}${f.nullflag === 1 ? "!" : "-"}` +
        (CUSTOM_FIELD.test(key) ? " [自定义]" : "");
      const extra = f.reftype ? String(f.reftype).slice(0, 60) : f.defaultvalue ? `默认:${String(f.defaultvalue).slice(0, 40)}` : "";
      console.log(`  ${key.slice(0, 24).padEnd(24)}${(resolveName(f) || "").slice(0, 20).padEnd(21)}${flags.padEnd(16)}${extra}`);
    }
    console.log(`  (${tfields.length} 个字段)`);
    console.log();
  }
  if (heads.length > shown.length) {
    console.log(`匹配到 ${heads.length} 个模板，仅展开前 ${opts.limit} 个（调大 --limit）`);
  }
}
