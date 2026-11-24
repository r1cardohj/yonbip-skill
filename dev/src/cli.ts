#!/usr/bin/env node
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  activeProfile,
  configPath,
  fail,
  loadConfig,
  removeProfile,
  updateProfile,
  type Profile,
} from "./config.ts";

interface Args {
  cmd?: string;
  sub?: string;
  positional: string[];
  opts: Record<string, string>;
  listOpts: Record<string, string[]>;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { positional: [], opts: {}, listOpts: {}, help: false };
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") a.help = true;
    else if (arg === "--json") a.opts.json = "true";
    else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[++i] ?? "";
      (a.listOpts[key] ??= []).push(value);
      a.opts[key] = value;
    } else words.push(arg);
  }
  [a.cmd, a.sub] = words;
  a.positional = words.slice(2);
  return a;
}

const HELP = `yonbip-dev — YonBIP 高级版二开开发环境配置 CLI

记录 NCHOME 与前后端代码工程位置，供 agent 定位代码进行开发。
支持多 profile 切换多套环境（开发/测试）。

用法: yonbip-dev <命令> [子命令] [参数] [选项]

命令:
  set           配置开发环境路径
                --nc-home <dir>    NCHOME 目录（含 modules/hotwebs 的运行时）
                --front <dir>      前端工程目录（可多次传入，配置多个）
                --back <dir>       后端工程目录（可多次传入，配置多个）
                --profile <name>   配置名（默认 default，可配多套环境）
  info          输出当前/指定 profile 的路径（agent 用它定位代码）
                --profile <name>   指定 profile（默认当前激活的）
                --json             结构化输出
  auth status   查看所有 profile
  auth logout   删除指定或当前 profile

配置文件: ${configPath()}（权限 600）
`;

function checkDir(path: string, label: string): void {
  if (!existsSync(path)) fail(`${label} 目录不存在: ${path}`);
  if (!statSync(path).isDirectory()) fail(`${label} 不是目录: ${path}`);
}

function warnNcHome(ncHome: string): void {
  const hints = ["modules", "hotwebs", "ierp", "bin"];
  const missing = hints.filter((d) => !existsSync(join(ncHome, d)));
  if (hints.length - missing.length < 2) {
    console.log(`⚠ ${ncHome} 下未找到 ${hints.join("/")} 等典型 NCHOME 结构，请确认路径正确`);
  }
}

function printProfile(name: string, p: Profile, json: boolean): void {
  if (json) {
    console.log(JSON.stringify({ profile: name, ...p }, null, 2));
    return;
  }
  console.log(`profile: ${name}`);
  console.log(`  nc-home: ${p.ncHome}`);
  console.log(`  front:   ${p.front.length ? p.front.join(", ") : "(未配置)"}`);
  console.log(`  back:    ${p.back.length ? p.back.join(", ") : "(未配置)"}`);
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  if (a.help || !a.cmd) {
    console.log(HELP);
    return;
  }

  const key = a.cmd === "auth" ? `${a.cmd} ${a.sub ?? ""}`.trim() : a.cmd;
  switch (key) {
    case "set": {
      const ncHome = a.opts["nc-home"] ?? fail("缺少 --nc-home");
      const fronts = a.listOpts.front ?? [];
      const backs = a.listOpts.back ?? [];
      if (!fronts.length && !backs.length) fail("至少需要 --front 或 --back 一个路径");
      const profile = a.opts.profile ?? "default";

      const absNcHome = resolve(ncHome);
      const absFronts = fronts.map((d) => resolve(d));
      const absBacks = backs.map((d) => resolve(d));
      checkDir(absNcHome, "nc-home");
      absFronts.forEach((d) => checkDir(d, "front"));
      absBacks.forEach((d) => checkDir(d, "back"));

      updateProfile(profile, { ncHome: absNcHome, front: absFronts, back: absBacks });
      console.log(`已保存 profile "${profile}"`);
      printProfile(profile, loadConfig()!.profiles[profile], a.opts.json === "true");
      warnNcHome(absNcHome);
      break;
    }
    case "info": {
      const { name, profile } = activeProfile(a.opts.profile);
      printProfile(name, profile, a.opts.json === "true");
      break;
    }
    case "auth status": {
      const cfg = loadConfig();
      if (!cfg || !Object.keys(cfg.profiles).length) fail("尚未配置任何 profile");
      for (const [name, p] of Object.entries(cfg.profiles)) {
        const mark = name === cfg.active ? "*" : " ";
        console.log(`${mark} ${name}`);
        console.log(`    nc-home: ${p.ncHome}`);
        console.log(`    front:   ${p.front.length} 个工程`);
        console.log(`    back:    ${p.back.length} 个工程`);
      }
      console.log(`\n(* 为当前激活，共 ${Object.keys(cfg.profiles).length} 个 profile)`);
      break;
    }
    case "auth logout": {
      const cfg = loadConfig();
      if (!cfg) fail("尚未配置任何 profile");
      const name = a.positional[0] ?? a.opts.profile ?? cfg.active;
      if (!removeProfile(name)) fail(`profile "${name}" 不存在`);
      console.log(`已删除 profile "${name}"`);
      break;
    }
    default:
      fail(`未知命令: ${a.cmd}${a.sub ? " " + a.sub : ""}（-h 查看帮助）`);
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
