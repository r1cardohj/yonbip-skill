#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { ensureToken, fetchToken, tokenUsable } from "./auth.ts";
import { callApi, checkBusinessError } from "./client.ts";
import { activeProfile, configPath, fail, loadConfig, removeProfile, updateProfile } from "./config.ts";
import { loadApiDoc, searchCatalog } from "./catalog.ts";
import {
  buildBody,
  extractRows,
  formatRows,
  loadRefMap,
  resolveEntry,
  resolveEntryByRefId,
  type RefEntry,
} from "./refs.ts";

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

const HELP = `yonbip-api — YonBIP 高级版 OpenAPI CLI（NC Cloud OPM 认证）

用法: yonbip-api <命令> [子命令] [参数] [选项]

命令:
  auth login   配置凭证并获取 token
  auth login   配置凭证并获取 token
                --gateway <url>     环境地址，如 http://<host>:<port>
                --app-id <id>       开放平台应用编码（OPM 第三方应用 code）
                --app-secret <s>    应用密文
                --pub-key <k>       应用公钥（OPM 中显示的那串 base64）
                --biz-center <c>    账套编码（如 001）
                --profile <name>    配置名（默认 default，可配多套环境）
  auth status   查看当前配置与 token 状态
  auth refresh  强制重新获取 token
  auth logout   删除指定或当前 profile

  call <path>   调用 OpenAPI（POST），path 相对 nccloud/api
                --body '<json>' 或 --body @file.json（默认 {}）
                自动带 access_token / client_id / signature / repeat_check / ucg_flag
  token         打印当前 access_token（给其他工具/调试用）
  apis <关键词> 在已导出的接口目录中搜索，显示真实请求路径
                （openapi/data/api-catalog.json + api-urls.json）
  doc <关键词|pk>  查看接口文档：真实 URL、请求示例、参数表
                （openapi/data/api-docs.json，未导出的接口提示到 OPM 查看）

  refs [档案类型] [关键词]  按名称/编码查档案主数据，返回 pk / code / name
                --ref <refId>   用字典 fields 输出里的引用模型 id 定位档案类型
                --code <编码>   按编码精确查（默认按名称模糊）
                --org <pk>      附加业务单元条件（人员/物料等接口必填）
                --group <pk>    附加集团条件（供应商/项目等接口必填）
                --limit <n>     返回条数（默认 30）
                --json          输出结构化结果
                --map <file>    追加加载自定义映射文件
  refs types    列出支持的档案类型及映射状态（✓=路径已验证）

凭证存储: ${configPath()}（权限 600）

说明:
  - 认证算法与官方 SDK（nccloud.open.api.auto.token.cur.utils）一致:
    client_secret 用 RSA/OAEP-SHA256 加密；signature 为带盐 SHA256，
    盐 = Base64(SHA1(SHA1(pubKey))[0:16])，纯 Node 实现，无需 Java。
  - token 有效期约 11 天（expires_in=1000000），调用前自动刷新。
  - 应用能调哪些接口由 OPM 中的"关联API"决定；未关联的接口报
    "第三方应用没有 xxx 的权限"。
`;

function parseBody(raw: string | undefined): unknown {
  if (raw === undefined) return {};
  const text = raw.startsWith("@") ? readFileSync(raw.slice(1), "utf8") : raw;
  try {
    return JSON.parse(text);
  } catch {
    fail(`--body 不是合法 JSON${raw.startsWith("@") ? `（文件 ${raw.slice(1)}）` : ""}`);
  }
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  if (a.help || !a.cmd) {
    console.log(HELP);
    return;
  }

  const key = a.cmd === "auth" ? `${a.cmd} ${a.sub ?? ""}`.trim() : a.cmd!;
  switch (key) {
    case "auth login": {
      const gateway = a.opts.gateway ?? fail("缺少 --gateway");
      const appId = a.opts["app-id"] ?? fail("缺少 --app-id");
      const appSecret = a.opts["app-secret"] ?? fail("缺少 --app-secret");
      const pubKey = (a.opts["pub-key"] ?? fail("缺少 --pub-key")).replace(/\s+/g, "");
      const bizCenter = a.opts["biz-center"] ?? fail("缺少 --biz-center");
      const profile = a.opts.profile ?? "default";
      updateProfile(profile, {
        gateway: gateway.replace(/\/$/, ""),
        appId,
        appSecret,
        pubKey,
        bizCenter,
        token: undefined,
      });
      const p = activeProfile();
      const token = await fetchToken(p);
      updateProfile(profile, {
        token: { value: token.value, expiresAt: token.expiresAt },
        securityKey: token.securityKey,
      });
      console.log(`已登录 profile "${profile}"`);
      console.log(`  gateway:   ${p.gateway}`);
      console.log(`  appId:     ${p.appId}`);
      console.log(`  bizCenter: ${p.bizCenter}`);
      console.log(`  token:     ${token.value.slice(0, 12)}... 有效期至 ${new Date(token.expiresAt).toLocaleString()}`);
      break;
    }
    case "auth status": {
      const cfg = loadConfig();
      if (!cfg) fail("尚未配置任何 profile");
      for (const [name, p] of Object.entries(cfg.profiles)) {
        const mark = name === cfg.active ? "*" : " ";
        console.log(`${mark} ${name}`);
        console.log(`    gateway:   ${p.gateway}`);
        console.log(`    appId:     ${p.appId}`);
        console.log(`    bizCenter: ${p.bizCenter}`);
        if (p.token) {
          const left = Math.round((p.token.expiresAt - Date.now()) / 60000);
          console.log(`    token:     ${tokenUsable(p) ? `有效，剩余约 ${left} 分钟` : "已过期"}`);
        } else {
          console.log(`    token:     未获取`);
        }
      }
      break;
    }
    case "auth refresh": {
      const cfg = loadConfig();
      if (!cfg) fail("尚未配置任何 profile");
      const token = await ensureToken(cfg.active, cfg.profiles[cfg.active], true);
      console.log(`token 已刷新: ${token.slice(0, 12)}...`);
      break;
    }
    case "auth logout": {
      const name = a.positional[0] ?? loadConfig()?.active;
      if (!name) fail("没有可删除的 profile");
      console.log(removeProfile(name) ? `已删除 profile "${name}"` : `profile "${name}" 不存在`);
      break;
    }
    case "token": {
      const cfg = loadConfig();
      if (!cfg) fail("尚未配置任何 profile");
      console.log(await ensureToken(cfg.active, cfg.profiles[cfg.active]));
      break;
    }
    case "token": {
      const cfg = loadConfig();
      if (!cfg) fail("尚未配置任何 profile");
      console.log(await ensureToken(cfg.active, cfg.profiles[cfg.active]));
      break;
    }
    case "call": {
      const path = a.sub ?? fail("缺少 path: yonbip-api call <path>");
      const body = await callApi(path, parseBody(a.opts.body));
      checkBusinessError(body);
      console.log(JSON.stringify(body, null, 2));
      break;
    }
    case "apis": {
      const kw = a.sub ?? fail("缺少关键词: yonbip-api apis <关键词>");
      const hits = searchCatalog(kw, 30);
      if (!hits.length) console.log("无结果");
      for (const h of hits) {
        console.log(`  ${h.pk}  ${h.apiuri ?? "(无URL)"}`);
        console.log(`    ${h.name}  —  ${h.path}`);
      }
      console.log(`\n共 ${hits.length} 条（前 30）`);
      break;
    }
    case "doc": {
      const kw = a.sub ?? fail("缺少关键词或 pk: yonbip-api doc <关键词|pk>");
      const all = searchCatalog(kw, 200);
      const exact = all.filter((h) => h.pk === kw || h.name === kw);
      const fuzzy = all.filter((h) => !exact.includes(h));
      const candidates = exact.length ? exact : fuzzy;
      if (!candidates.length) fail(`接口目录中没有匹配 "${kw}" 的接口`);
      if (!exact.length && candidates.length > 1) {
        console.log(`# "${kw}" 命中 ${candidates.length} 个接口，已列出前 5 个（可用 pk 精确指定）:`);
        for (const c of candidates.slice(0, 5)) console.log(`  ${c.pk}  ${c.apiuri ?? "(无URL)"}  ${c.name}`);
        console.log("");
      }
      const api = candidates[0];
      const doc = loadApiDoc(api.pk);
      console.log(`# ${api.name}\n  pk:  ${api.pk}\n  URL: ${doc?.apiuri ?? api.apiuri ?? "(未知)"}`);
      if (!doc) {
        console.log(`\n（接口文档尚未导出，可在 OPM > OpenAPI管理 中查看 pk ${api.pk}；`);
        console.log(` 运行 scripts/fetch-api-docs.mjs 可更新本地文档缓存）`);
        break;
      }
      const params = doc.requestParam
        .filter((p) => p.type !== "Map" && p.type !== "Array")
        .map((p) => `  ${p.name.padEnd(16)}${p.type.padEnd(8)}${p.desc ?? ""}`);
      if (params.length) console.log(`\n请求参数:\n${params.join("\n")}`);
      if (doc.requestExample) console.log(`\n请求示例:\n${doc.requestExample}`);
      if (doc.responseExample) console.log(`\n响应示例:\n${doc.responseExample.slice(0, 1500)}`);
      if (!a.opts.json) break;
      console.log(`\n${JSON.stringify(doc, null, 2)}`);
      break;
    }
    case "refs": {
      const map = loadRefMap(a.opts.map);
      if (a.sub === "types") {
        for (const [k, e] of Object.entries(map.entries)) {
          const need = [
            e.orgParam || e.orgAsCode ? `--org <组织${e.orgAsCode ? "编码" : "pk"}>` : "",
            e.groupParam ? "--group <集团pk>" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const api = e.api
            ? `${e.api.name}  ${e.api.path}${e.api.verified ? "  ✓ 已验证" : "  (未做过端到端调用)"}${need ? `  需 ${need}` : ""}`
            : "（目录中无查询接口）";
          console.log(`  ${k.padEnd(12)}${e.label}  →  ${api}`);
          if (e.note) console.log(`  ${" ".repeat(12)}  ${e.note}`);
        }
        console.log(`\n共 ${Object.keys(map.entries).length} 类；映射表: openapi/data/ref-map.json，可用 ~/.config/yonbip-api/ref-map.json 覆盖`);
        break;
      }
      const limit = parseInt(a.opts.limit, 10) || 30;
      let entry: RefEntry | undefined;
      if (a.opts.ref) {
        entry = resolveEntryByRefId(map, a.opts.ref);
        if (!entry) fail(`字典引用模型 id "${a.opts.ref}" 不在映射表中（refs types 查看全部；可在本地 ref-map.json 补充条目）`);
      } else {
        const t = a.sub ?? fail("缺少档案类型: yonbip-api refs <档案类型> <关键词>（refs types 查看全部）");
        entry = resolveEntry(map, t);
        if (!entry) {
          const known = Object.entries(map.entries)
            .map(([k, e]) => `${k}(${e.label})`)
            .join("  ");
          fail(`未知档案类型 "${t}"\n支持: ${known}`);
        }
      }
      if (!entry.api) {
        console.log(`# ${entry.label} —— 接口目录中无查询接口，refs 无法直接解析`);
        if (entry.note) console.log(`说明: ${entry.note}`);
        const hints = searchCatalog(entry.aliases[0] ?? entry.label, 8);
        if (hints.length) {
          console.log(`目录中可能相关的接口（可用 apis 命令继续查）:`);
          for (const h of hints) console.log(`  ${h.pk}  ${h.path}`);
        }
        break;
      }
      const keyword = a.positional[0] ?? (a.opts.ref ? a.sub : undefined);
      const noData = (msg: string) => /没有符合条件的数据|no\s*data/i.test(msg);
      const query = async (kw?: string, code?: string, size = limit) => {
        try {
          return await callApi(
            entry!.api!.path,
            buildBody(entry!, { keyword: kw, code, org: a.opts.org, group: a.opts.group, limit: size })
          );
        } catch (e) {
          if (noData((e as Error).message)) return { data: [] };
          throw e;
        }
      };

      let res: unknown;
      try {
        res = await query(keyword, a.opts.code);
      } catch (e) {
        fail(
          `调用失败: ${(e as Error).message}\n` +
            `  接口: ${entry.api.name} (pk ${entry.api.pk})\n` +
            `  路径: ${entry.api.path}` +
            (entry.api.verified ? "" : "\n  该路径尚未在真实环境验证；可用 apis <关键词> 查到 OPM 中的真实 URL 后，在 ~/.config/yonbip-api/ref-map.json 覆盖")
        );
      }
      const first = res as { success?: boolean; message?: string };
      const emptyFirst = first?.success === false && noData(String(first.message ?? ""));
      if (!emptyFirst) checkBusinessError(res);
      let result = extractRows(emptyFirst ? { data: [] } : res, entry, keyword);
      // 多数档案查询接口的名称/编码条件是精确匹配；无结果时不用条件重拉一次，本地模糊过滤
      if (keyword && !result.rows.length && !a.opts.code) {
        const scanSize = Math.max(limit, 200);
        const all = extractRows(await query(undefined, undefined, scanSize), entry, keyword);
        if (all.rows.length) result = { ...all, matched: true };
        else result = { rows: all.rows, total: all.total, matched: false };
      }
      if ("json" in a.opts) {
        const key = Object.entries(map.entries).find(([, e]) => e === entry)![0];
        console.log(JSON.stringify({ type: key, label: entry.label, api: entry.api, ...result }, null, 2));
      } else {
        console.log(formatRows(entry, result));
      }
      break;
    }
    default:
      fail(`未知命令: ${a.cmd} ${a.sub ?? ""}\n\n${HELP}`);
  }
}

main().catch((e) => fail((e as Error).message));
