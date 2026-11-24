import { runQuery, type QueryResult } from "./client.ts";

// 用户自定义项命名查询：把「物理表/单据类型 → 用户起的字段名」缩成一条命令。
// 链路：物理表 → bd_billtype.component（如 sc_order_v60）→ 单据类型族（61）
// → bd_userdefrule（61_H 表头 / 61_B、61_C 表体）→ bd_userdefitem.propindex → showname
// → 物理槽位（vdefN=表头 / vbdefN=表体，NC 固定约定）。

function rowsOf(result: QueryResult): Record<string, unknown>[] {
  return result.rows.map((r) => Object.fromEntries(result.columns.map((c, i) => [c, r[i]])));
}

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

// 规则编码形态：[模块_]族[_H/_B/_C]，如 61_B / erm_264X_B / custsale；用 [_] 字符类避免转义
function ruleConds(family: string): string {
  const f = esc(family);
  return `r.code = '${f}' OR r.code LIKE '${f}[_]%' OR r.code LIKE '%[_]${f}' OR r.code LIKE '%[_]${f}[_]%'`;
}

interface Rule {
  pk: string;
  code: string;
  name: string;
  isBody: boolean;
}

async function fetchRules(families: Set<string>): Promise<Rule[]> {
  const conds = [...families].map(ruleConds).join(" OR ");
  const rules = rowsOf(
    await runQuery(
      `SELECT r.pk_userdefrule, r.code, r.name FROM bd_userdefrule r WHERE (r.dr = 0 OR r.dr IS NULL) AND (${conds})`,
      30000
    )
  );
  return rules.map((r) => ({
    pk: String(r.pk_userdefrule),
    code: String(r.code),
    name: String(r.name ?? ""),
    isBody: /_(B|C|BODY\d*)$/i.test(String(r.code)),
  }));
}

async function fetchItems(rules: Rule[]): Promise<Record<string, unknown>[]> {
  const pks = rules.map((r) => `'${esc(r.pk)}'`).join(",");
  return rowsOf(
    await runQuery(
      `SELECT i.pk_userdefrule, i.propindex, i.showname, i.enabled, i.inputlength,
              m.displayname AS valuetype
       FROM bd_userdefitem i LEFT JOIN md_class m ON i.classid = m.id
       WHERE (i.dr = 0 OR i.dr IS NULL) AND i.pk_userdefrule IN (${pks})
         AND i.showname IS NOT NULL AND i.showname <> '~' AND i.showname <> ''
       ORDER BY i.pk_userdefrule, i.propindex`,
      30000
    )
  );
}

function slotOf(rule: Rule, propindex: number): string {
  return `${rule.isBody ? "vbdef" : "vdef"}${propindex}`;
}

export interface UserDefOptions {
  keyword?: string;
  table?: string;
  json: boolean;
}

export async function queryUserDef(opts: UserDefOptions): Promise<void> {
  const families = new Set<string>();
  let tableGuess: string | null = null;

  if (opts.table) {
    tableGuess = opts.table;
    // sc_order_b → sc_order（依次去 _b/_s/_v 后缀），与 bd_billtype.component 前缀匹配
    const bases = [opts.table];
    const stripped = opts.table.replace(/_(b|s|v\d*)$/i, "");
    if (stripped !== opts.table) bases.push(stripped);
    const conds = bases.map((b) => `(component LIKE '${esc(b)}[_]%' OR component = '${esc(b)}' OR component LIKE '${esc(b)}%')`).join(" OR ");
    const bills = rowsOf(
      await runQuery(
        `SELECT pk_billtypecode, parentbilltype, billtypename FROM bd_billtype
         WHERE (dr = 0 OR dr IS NULL) AND (${conds})`,
        30000
      )
    );
    for (const b of bills) {
      const code = String(b.pk_billtypecode ?? "").trim();
      const parent = String(b.parentbilltype ?? "").trim();
      if (code) families.add(code);
      if (parent && parent !== "~") families.add(parent);
      if (code) families.add(code.replace(/.$/, "X"));
    }
    if (!families.size) {
      throw new Error(`表 ${opts.table} 没能关联到单据类型（bd_billtype.component 无匹配），改用关键词查: userdef 委外`);
    }
  } else if (opts.keyword) {
    const kw = esc(opts.keyword);
    const bills = rowsOf(
      await runQuery(
        `SELECT pk_billtypecode, parentbilltype FROM bd_billtype
         WHERE (dr = 0 OR dr IS NULL) AND (pk_billtypecode LIKE '%${kw}%' OR billtypename LIKE '%${kw}%')`,
        30000
      )
    );
    for (const b of bills) {
      const code = String(b.pk_billtypecode ?? "").trim();
      const parent = String(b.parentbilltype ?? "").trim();
      if (code) families.add(code);
      if (parent && parent !== "~") families.add(parent);
    }
    families.add(opts.keyword);
    families.add(opts.keyword.replace(/.$/, "X"));
  } else {
    throw new Error("缺少参数: userdef <关键词> 或 userdef --table <物理表名>");
  }

  const rules = await fetchRules(families);
  if (!rules.length) {
    throw new Error(`单据类型族 [${[...families].join(", ")}] 没有自定义项规则（bd_userdefrule）`);
  }
  const items = await fetchItems(rules);

  // 物理槽位存在性校验（只对 --table 模式有意义）
  let existingCols = new Set<string>();
  if (tableGuess) {
    const cols = rowsOf(
      await runQuery(`SELECT c.name FROM sys.columns c WHERE c.object_id = OBJECT_ID('${esc(tableGuess)}')`, 30000)
    );
    existingCols = new Set(cols.map((c) => String(c.name)));
  }

  const byRule = new Map(rules.map((r) => [r.pk, r]));
  const lines = items.map((it) => {
    const rule = byRule.get(String(it.pk_userdefrule))!;
    const idx = Number(it.propindex);
    const slot = slotOf(rule, idx);
    const colOk = tableGuess ? (existingCols.has(slot) ? "✓" : "✗无此列") : "";
    return {
      规则: rule.code,
      规则名: rule.name,
      位置: rule.isBody ? "表体" : "表头",
      属性: `prop${idx}`,
      用户命名: String(it.showname).trim(),
      类型: String(it.valuetype ?? ""),
      物理字段: slot,
      列校验: colOk,
      启用: it.enabled === "Y" ? "Y" : "N",
    };
  });

  if (opts.json) {
    console.log(JSON.stringify(lines, null, 2));
    return;
  }
  if (!lines.length) {
    console.log("规则存在但没有任何已命名的自定义项（用户未定义名称）");
    return;
  }
  const headers = ["规则", "位置", "属性", "用户命名", "类型", "物理字段", "列校验", "启用"];
  const widths = headers.map((h) =>
    Math.max(h.length, ...lines.map((l) => String(l[h as keyof typeof l] ?? "").length))
  );
  const row = (cells: string[]) => "  " + cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(row(headers));
  console.log("  " + widths.map((w) => "-".repeat(w)).join("  "));
  for (const l of lines) console.log(row(headers.map((h) => String(l[h as keyof typeof l] ?? ""))));
  console.log(`\n(${lines.length} 个已命名自定义项)`);
  if (!opts.table) console.log("提示: 加 --table <物理表名> 可校验物理列并直接定位字段");
}
