#!/usr/bin/env node
// 批量抓取 OPM OpenAPI 接口 VO（真实 URL / 使用场景 / 文档路径）
// 用法: node scripts/fetch-api-urls.mjs [--limit N] [--delay ms]
// 会话来自 ~/.config/yonbip-api/opm-cookies.json（由浏览器会话导出）
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "../src/catalog.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "data", "api-urls.json");
const COOKIES = join(process.env.HOME ?? "~", ".config", "yonbip-api", "opm-cookies.json");
const GATEWAY = process.env.OPM_GATEWAY ?? "http://158.28.1.80";
const PAGE_CODE = "12601010_apimanager";
const FORM_ID = "apimanager_form";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const delay = Number(opt("delay", 250));
const limit = Number(opt("limit", 0));

const jar = JSON.parse(readFileSync(COOKIES, "utf8"))
  .map((c) => `${c.name}=${c.value}`)
  .join("; ");

const done = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const apis = loadCatalog().filter((a) => !done[a.pk]);
const todo = limit > 0 ? apis.slice(0, limit) : apis;
console.log(`total=${loadCatalog().length} done=${Object.keys(done).length} todo=${todo.length} delay=${delay}ms`);

const save = () => {
  writeFileSync(OUT + ".tmp", JSON.stringify(done, null, 1));
  renameSync(OUT + ".tmp", OUT);
};

let ok = 0, fail = 0;
for (const api of todo) {
  const ts = Date.now();
  try {
    const r = await fetch(`${GATEWAY}/nccloud/opm/apimanager/LoadApiVOAction.do`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        Cookie: jar,
        cookiets: String(ts),
        transcode: "12601010",
        crux: String(ts),
      },
      body: JSON.stringify({
        busiParamJson: JSON.stringify({ pk: api.pk, pageCode: PAGE_CODE, formId: FORM_ID }),
        sysParamJson: {
          busiaction: "OpenAPI维护-合并请求",
          appcode: "12601010",
          tabid: "",
          ts,
          from: "",
          pagecs: String(ts),
        },
      }),
      signal: AbortSignal.timeout(30000),
    });
    const j = await r.json();
    if (j.error) {
      fail++;
      done[api.pk] = { pk: api.pk, error: j.error.message };
    } else {
      const v = j?.data?.data?.head?.[FORM_ID]?.rows?.[0]?.values ?? {};
      const g = (k) => v[k]?.value ?? null;
      done[api.pk] = {
        pk: api.pk,
        code: g("code"),
        name: g("name"),
        apiuri: g("apiuri"),
        usescene: g("usescene"),
        describe: g("describe"),
        docpath: g("docpath"),
        module_code: g("module_code"),
      };
      ok++;
    }
  } catch (e) {
    fail++;
    done[api.pk] = { pk: api.pk, error: String(e).slice(0, 120) };
  }
  if ((ok + fail) % 25 === 0) {
    save();
    console.log(`progress ${ok + fail}/${todo.length} ok=${ok} fail=${fail}`);
  }
  await new Promise((res) => setTimeout(res, delay));
}
save();
console.log(`DONE ok=${ok} fail=${fail} saved=${Object.keys(done).length}`);
