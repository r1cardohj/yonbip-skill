import { existsSync, unlinkSync } from "node:fs";
import {
  detailCount,
  ensureBase,
  fail,
  indexUrl,
  paths,
  readJson,
  readJsonl,
  writeJson,
  writeJsonl,
} from "./store.js";
import { downloadFile, parseRef } from "./api.js";
import type { DictIndexMeta, FieldRec, RawTable, TableMeta } from "./types.js";

interface RawIndex extends DictIndexMeta {
  source: string;
  detailPattern: string;
  tables: RawTable[];
}

export async function syncIndex(base: string): Promise<void> {
  ensureBase();
  console.log(`下载索引 ${indexUrl(base)} ...`);
  try {
    await downloadFile(indexUrl(base), paths.indexJson);
  } catch (e) {
    fail(`索引下载失败: ${(e as Error).message}\n请检查 --base 或 YONBIP_DICT_BASE 是否指向 dict-browser 服务`);
  }

  const raw = readJson<RawIndex>(paths.indexJson);
  const tables: TableMeta[] = raw.tables.map((t) => ({
    id: t.id,
    tableName: t.tableName,
    displayName: t.displayName,
    fullClassname: t.fullClassname,
    module: t.module,
    moduleCode: t.moduleCode,
    fieldCount: t.fieldCount,
    requiredCount: t.requiredCount,
    keyFields: t.keyFields,
  }));
  writeJsonl(paths.tablesJsonl, tables);
  writeJson(paths.modulesJson, raw.modules);
  unlinkSync(paths.indexJson);

  const { version, generatedAt, totals } = raw;
  console.log(`版本: ${version}  生成时间: ${generatedAt}`);
  console.log(`表: ${totals.tables}  模块: ${raw.modules.length}  字段总数: ${totals.fields}`);
  console.log(`本地表索引: ${paths.tablesJsonl}`);
  console.log(`提示: 运行 yonbip-dict sync --fields 拉取全部字段明细（约 ${totals.tables} 个文件）`);
}

async function pool<T>(items: T[], jobs: number, worker: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  let done = 0;
  const errors: string[] = [];
  const runners = Array.from({ length: jobs }, async () => {
    while (i < items.length) {
      const item = items[i++];
      try {
        await worker(item);
      } catch (e) {
        errors.push((e as Error).message);
      }
      if (++done % 500 === 0) console.log(`  进度 ${done}/${items.length}`);
    }
  });
  await Promise.all(runners);
  if (errors.length) {
    console.error(`${errors.length} 个文件拉取失败，示例: ${errors[0]}`);
  }
}

export async function syncFields(base: string, jobs: number): Promise<void> {
  ensureBase();
  if (!existsSync(paths.tablesJsonl)) {
    fail("请先运行 yonbip-dict sync");
  }
  const tables = readJsonl<TableMeta>(paths.tablesJsonl);
  const missing = tables.filter((t) => !existsSync(paths.detailFile(t.id)));
  if (missing.length) {
    console.log(`拉取字段明细: ${missing.length}/${tables.length} (并发 ${jobs}) ...`);
    await pool(missing, jobs, async (t) => {
      const { getDetail } = await import("./api.js");
      await getDetail(base, t.id);
    });
  } else {
    console.log("字段明细已齐全，仅重建字段索引");
  }

  console.log("重建 fields.jsonl ...");
  const rows: FieldRec[] = [];
  for (const t of tables) {
    const file = paths.detailFile(t.id);
    if (!existsSync(file)) continue;
    const detail = readJson<{ propertyVO?: unknown[] }>(file);
    const fields = (detail.propertyVO ?? []) as Record<string, unknown>[];
    for (const f of fields) {
      const ref = parseRef(f.refClassPathHref as string | undefined);
      rows.push({
        t: t.id,
        tbl: t.tableName,
        n: (f.name as string) ?? "",
        dn: (f.displayName as string) ?? "",
        ty: (f.dataTypeSql as string) ?? "",
        ref: ref.refId,
        k: Boolean(f.keyProp),
        nl: Boolean(f.nullable),
      });
    }
  }
  writeJsonl(paths.fieldsJsonl, rows);
  console.log(`字段索引: ${paths.fieldsJsonl} (${rows.length} 条, 缓存明细 ${detailCount()} 个)`);
}
