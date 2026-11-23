#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureToken, fetchToken, tokenUsable } from "./auth.ts";
import { callApi, checkBusinessError } from "./client.ts";
import { activeProfile, configPath, fail, loadConfig, removeProfile, updateProfile } from "./config.ts";

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
  apis <关键词> 在已导出的接口目录中搜索（openapi/data/api-catalog.json）

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

function loadCatalog(): { pk: string; name: string; path: string }[] {
  const dataFile = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "api-catalog.json");
  const raw = JSON.parse(readFileSync(dataFile, "utf8")) as {
    data: { refname?: string; refpk?: string; nodeData?: { pk_api?: string; name?: string }; children?: unknown[] }[];
  };
  const out: { pk: string; name: string; path: string }[] = [];
  const walk = (nodes: typeof raw.data, prefix: string) => {
    for (const n of nodes) {
      const name = (n.nodeData?.name ?? n.refname ?? "").trim();
      const p = prefix ? `${prefix}/${name}` : name;
      if (n.children && n.children.length) walk(n.children as typeof raw.data, p);
      else if (n.nodeData?.pk_api) out.push({ pk: n.nodeData.pk_api, name, path: p });
    }
  };
  walk(raw.data, "");
  return out;
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
      const catalog = loadCatalog();
      const q = kw.toLowerCase();
      const hits = catalog.filter((c) => c.name.toLowerCase().includes(q) || c.path.toLowerCase().includes(q));
      if (!hits.length) console.log("无结果");
      for (const h of hits.slice(0, 30)) {
        console.log(`  ${h.pk}  ${h.path}`);
      }
      console.log(`\n共 ${hits.length} 条`);
      break;
    }
    default:
      fail(`未知命令: ${a.cmd} ${a.sub ?? ""}\n\n${HELP}`);
  }
}

main().catch((e) => fail((e as Error).message));
