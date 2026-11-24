#!/usr/bin/env node
import { configPath, fail, loadConfig, removeProfile, updateProfile } from "./config.ts";
import { runQuery, type QueryResult } from "./client.ts";
import { assertReadOnly } from "./guard.ts";

interface Args {
  cmd?: string;
  sub?: string;
  positional: string[];
  opts: Record<string, string>;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { positional: [], opts: {}, help: false };
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") a.help = true;
    else if (arg.startsWith("--")) a.opts[arg.slice(2)] = argv[++i] ?? "";
    else words.push(arg);
  }
  [a.cmd, a.sub] = words;
  a.positional = words.slice(2);
  return a;
}

const HELP = `yonbip-db — YonBIP 高级版数据库直连 CLI（SQL Server）

用法: yonbip-db <命令> [子命令] [参数] [选项]

命令:
  auth login    配置数据库连接
                --host <host>           数据库地址
                --port <port>           端口（默认 1433）
                --database <name>       库名
                --user <user>           用户名
                --password <pwd>        密码
                --encrypt true|false    加密连接（默认 false）
                --profile <name>        配置名（默认 default，可配多套环境）
  auth status   查看当前配置
  auth logout   删除指定或当前 profile

  query <sql>   执行只读查询（仅允许 SELECT/WITH/EXPLAIN，自动拒绝写操作、多语句、SELECT INTO）
                --json          结构化输出
                --timeout <秒>  超时（默认 60）
  exec <sql>    执行写操作（UPDATE/DELETE/INSERT/DDL），必须显式加 --confirm 才会真正执行
                --confirm       确认执行（不加则只打印待执行 SQL，不运行）
                --timeout <秒>  超时（默认 60）
  tables [过滤] 列出用户表（按名称模糊匹配）
  columns <表>  查看表结构（列名/类型/长度/可空/默认值）

凭证存储: ${configPath()}（权限 600）
`;

function formatTable(result: QueryResult): string {
  if (!result.columns.length) return "(无结果集) 影响行数: " + (result.rowsAffected[0] ?? 0);
  const strs = result.rows.map((r) => r.map((v) => (v === null || v === undefined ? "NULL" : String(v))));
  const widths = result.columns.map((c, i) => Math.max(c.length, ...strs.map((r) => r[i].length)));
  const line = (cells: string[]) => "  " + cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  const header = line(result.columns);
  const sep = "  " + widths.map((w) => "-".repeat(w)).join("  ");
  return [header, sep, ...strs.map(line)].join("\n");
}

function printResult(result: QueryResult, json: boolean): void {
  if (json) {
    const objects = result.rows.map((r) => Object.fromEntries(result.columns.map((c, i) => [c, r[i]])));
    console.log(JSON.stringify(objects, null, 2));
    return;
  }
  console.log(formatTable(result));
  console.log(`\n(${result.rows.length} 行)`);
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  if (a.help || !a.cmd) {
    console.log(HELP);
    return;
  }

  const key = a.cmd === "auth" ? `${a.cmd} ${a.sub ?? ""}`.trim() : a.cmd;
  switch (key) {
    case "auth login": {
      const host = a.opts.host ?? fail("缺少 --host");
      const port = parseInt(a.opts.port ?? "1433", 10);
      const database = a.opts.database ?? fail("缺少 --database");
      const user = a.opts.user ?? fail("缺少 --user");
      const password = a.opts.password ?? fail("缺少 --password");
      const profile = a.opts.profile ?? "default";
      updateProfile(profile, {
        driver: "mssql",
        host,
        port,
        database,
        user,
        password,
        encrypt: a.opts.encrypt === "true",
        trustServerCertificate: true,
      });
      // 立刻验证连通性，避免存了错误配置
      await runQuery("SELECT 1 AS ok");
      const p = loadConfig()!.profiles[profile];
      console.log(`已保存 profile "${profile}" 且连接验证通过`);
      console.log(`  ${p.user}@${p.host}:${p.port}/${p.database}`);
      break;
    }
    case "auth status": {
      const cfg = loadConfig();
      if (!cfg) fail("尚未配置任何 profile");
      for (const [name, p] of Object.entries(cfg.profiles)) {
        const mark = name === cfg.active ? "*" : " ";
        console.log(`${mark} ${name}  ${p.user}@${p.host}:${p.port}/${p.database}`);
      }
      break;
    }
    case "auth logout": {
      const name = a.positional[0] ?? loadConfig()?.active;
      if (!name) fail("没有可删除的 profile");
      console.log(removeProfile(name) ? `已删除 profile "${name}"` : `profile "${name}" 不存在`);
      break;
    }
    case "query": {
      const sqlText = a.sub ?? fail("缺少 SQL: yonbip-db query \"SELECT ...\"");
      assertReadOnly(sqlText);
      const timeout = parseInt(a.opts.timeout ?? "60", 10) * 1000;
      const result = await runQuery(sqlText, timeout);
      printResult(result, "json" in a.opts);
      break;
    }
    case "exec": {
      const sqlText = a.sub ?? fail("缺少 SQL: yonbip-db exec \"UPDATE ...\" --confirm");
      if (!("confirm" in a.opts)) {
        fail(`写操作需要显式确认。将执行:\n\n  ${sqlText}\n\n确认无误后追加 --confirm 重跑`);
      }
      const timeout = parseInt(a.opts.timeout ?? "60", 10) * 1000;
      const result = await runQuery(sqlText, timeout);
      console.log(`已执行。影响行数: ${result.rowsAffected.join(", ") || 0}`);
      if (result.columns.length) printResult(result, "json" in a.opts);
      break;
    }
    case "tables": {
      const filter = a.sub ? ` WHERE name LIKE '%${a.sub}%'` : "";
      const result = await runQuery(
        `SELECT name, create_date FROM sys.tables${filter} ORDER BY name`
      );
      printResult(result, "json" in a.opts);
      break;
    }
    case "columns": {
      const table = a.sub ?? fail("缺少表名: yonbip-db columns <表名>");
      const result = await runQuery(
        `SELECT c.name AS 列名, t.name AS 类型, c.max_length AS 长度, c.is_nullable AS 可空,
                OBJECT_DEFINITION(c.default_object_id) AS 默认值
         FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
         WHERE c.object_id = OBJECT_ID('${table.replace(/'/g, "''")}')
         ORDER BY c.column_id`
      );
      printResult(result, "json" in a.opts);
      break;
    }
    default:
      fail(`未知命令: ${a.cmd} ${a.sub ?? ""}\n\n${HELP}`);
  }
}

main().catch((e) => fail((e as Error).message));
