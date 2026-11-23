#!/usr/bin/env node
import { baseUrl, cacheSize, detailCount, fail, loadTables, paths } from "./store.ts";
import { fieldRowToJson, groupFieldHits, listFields, listModules, resolveTable, searchField, searchTables } from "./query.ts";
import { syncFields, syncIndex } from "./sync.ts";
import type { TableMeta } from "./types.ts";

interface Args {
  cmd?: string;
  positional: string[];
  base?: string;
  fields: boolean;
  json: boolean;
  limit: number;
  module?: string;
  jobs: number;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { positional: [], fields: false, json: false, limit: 30, jobs: 16, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--base":
        a.base = argv[++i];
        break;
      case "--fields":
        a.fields = true;
        break;
      case "--json":
        a.json = true;
        break;
      case "--limit":
        a.limit = parseInt(argv[++i], 10) || 30;
        break;
      case "--module":
        a.module = argv[++i];
        break;
      case "--jobs":
        a.jobs = parseInt(argv[++i], 10) || 16;
        break;
      case "-h":
      case "--help":
        a.help = true;
        break;
      default:
        if (arg.startsWith("--")) fail(`未知参数: ${arg}`);
        if (a.cmd === undefined) a.cmd = arg;
        else a.positional.push(arg);
    }
  }
  return a;
}

const HELP = `yonbip-dict — YonBIP 数据字典查询 CLI

用法: yonbip-dict <命令> [参数] [选项]

命令:
  sync                 下载表索引（约 31MB，解析后仅保留精简元数据）
  sync --fields        拉取全部表字段明细并构建全局字段索引（约 1.3 万个文件）
  search <关键词>      按表名/中文名/VO 类名/模块模糊搜索表
  table <表名|id>      查看单张表概览
  fields <表名|id>     查看表字段明细（主键/类型/引用/枚举值）
  field <字段名>       全局搜索字段出现在哪些表（需先 sync --fields）
  modules              列出全部模块及表数量
  info                 查看本地缓存状态

选项:
  --base <url>         数据源地址（dict-browser 服务，必填：--base 或 $YONBIP_DICT_BASE）
  --module <code>      search 时按模块过滤
  --limit <n>          结果条数（默认 30）
  --jobs <n>           sync --fields 并发数（默认 16）
  --json               输出 JSON（供脚本/Agent 使用）
  -h, --help           显示帮助

示例:
  yonbip-dict sync
  yonbip-dict sync --fields
  yonbip-dict search 销售订单
  yonbip-dict fields so_saleorder
  yonbip-dict field pk_org --limit 20
`;

function pad(s: string, w: number): string {
  const len = [...s].reduce((n, c) => n + (/[⺀-鿿＀-￯]/.test(c) ? 2 : 1), 0);
  return s + " ".repeat(Math.max(1, w - len));
}

function printTableRow(t: TableMeta): void {
  console.log(
    `  ${pad(t.tableName, 36)}${pad(t.displayName, 24)}${pad(t.moduleCode, 10)}字段:${String(t.fieldCount).padEnd(6)}id:${t.id}`
  );
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  if (a.help || !a.cmd) {
    console.log(HELP);
    return;
  }
  // 数据源地址按需解析：仅 sync / 需要远程拉明细时才要求
  const getBase = () => baseUrl(a.base);

  switch (a.cmd) {
    case "sync": {
      if (a.fields) {
        await syncFields(getBase(), a.jobs);
      } else {
        await syncIndex(getBase());
      }
      break;
    }
    case "search": {
      const kw = a.positional[0] ?? fail("缺少关键词: yonbip-dict search <关键词>");
      const hits = searchTables(kw, a.module, a.limit);
      if (a.json) {
        console.log(JSON.stringify(hits, null, 2));
      } else {
        if (!hits.length) console.log("无结果");
        hits.forEach(printTableRow);
      }
      break;
    }
    case "table": {
      const name = a.positional[0] ?? fail("缺少表名: yonbip-dict table <表名|id>");
      const t = resolveTable(name);
      const base = a.base ?? process.env.YONBIP_DICT_BASE;
      const source = base ? `${base.replace(/\/$/, "")}/dict-browser/index.html?id=${t.id}` : undefined;
      const detail = { ...t, ...(source ? { source } : {}) };
      if (a.json) {
        console.log(JSON.stringify(detail, null, 2));
      } else {
        console.log(`表名:      ${t.tableName}`);
        console.log(`中文名:    ${t.displayName}`);
        console.log(`VO 类:     ${t.fullClassname}`);
        console.log(`模块:      ${t.module} (${t.moduleCode})`);
        console.log(`字段数:    ${t.fieldCount} (必输 ${t.requiredCount})`);
        console.log(`主键:      ${t.keyFields.join(", ") || "-"}`);
        console.log(`字典页面:  ${source ?? "（未配置数据源，仅离线信息）"}`);
      }
      break;
    }
    case "fields": {
      const name = a.positional[0] ?? fail("缺少表名: yonbip-dict fields <表名|id>");
      const { table, fields } = await listFields(a.base, name);
      if (a.json) {
        console.log(JSON.stringify({ table, fields: fields.map(fieldRowToJson) }, null, 2));
      } else {
        console.log(`# ${table.tableName} ${table.displayName} (${table.module})`);
        for (const f of fields) {
          const flags = `${f.key ? "PK " : ""}${f.nullable ? "可空" : "必填"}`;
          let line = `  ${pad(f.name, 32)}${pad(f.displayName, 22)}${pad(f.type, 16)}${pad(flags, 10)}`;
          if (f.ref.refId) line += `引用: ${f.ref.refName}(${f.ref.refCode}) [${f.ref.refId}]`;
          else if (f.ref.refName) line += `类型: ${f.ref.refName}`;
          console.log(line);
          if (f.scope) console.log(`    枚举: ${f.scope}`);
          if (f.help) console.log(`    说明: ${f.help}`);
        }
      }
      break;
    }
    case "field": {
      const name = a.positional[0] ?? fail("缺少字段名: yonbip-dict field <字段名>");
      const hits = searchField(name, a.limit);
      if (a.json) {
        console.log(JSON.stringify(hits, null, 2));
      } else {
        if (!hits.length) console.log("无结果");
        for (const g of groupFieldHits(hits)) {
          const e = g.entries[0];
          const suffix = g.entries.length > 1 ? `  (${g.entries.length} 个字典条目)` : "";
          const ref = e.ref ? `  引用: ${e.ref}` : "";
          console.log(`  ${pad(e.n, 32)}${pad(e.dn, 22)}${pad(e.ty, 16)}${g.tableName}${ref}${suffix}`);
        }
        console.log(`\n共 ${hits.length} 条（--limit 可调整，--json 输出结构化结果）`);
      }
      break;
    }
    case "modules": {
      const mods = listModules();
      if (a.json) {
        console.log(JSON.stringify(mods, null, 2));
      } else {
        for (const m of mods) console.log(`  ${pad(m.code, 12)}${pad(m.name, 40)}${m.count} 张表`);
      }
      break;
    }
    case "info": {
      const tables = loadTables();
      console.log(`缓存目录:   ${paths.base}`);
      console.log(`表索引:     ${tables.length} 张`);
      console.log(`字段明细:   ${detailCount()} 个`);
      console.log(`缓存大小:   ${(cacheSize() / 1024 / 1024).toFixed(1)} MB`);
      break;
    }
    default:
      fail(`未知命令: ${a.cmd}\n\n${HELP}`);
  }
}

main().catch((e) => fail((e as Error).message));
