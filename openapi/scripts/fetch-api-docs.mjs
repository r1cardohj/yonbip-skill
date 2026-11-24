#!/usr/bin/env node
// 批量抓取 OPM OpenAPI 接口的请求/响应示例与参数表
// 用法: node scripts/fetch-api-docs.mjs [--limit N] [--delay ms]
// 会话来自 ~/.config/yonbip-api/opm-cookies.json
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const URLS = join(root, "data", "api-urls.json");
const OUT = join(root, "data", "api-docs.json");
const COOKIES = join(process.env.HOME ?? "~", ".config", "yonbip-api", "opm-cookies.json");
const GATEWAY = process.env.OPM_GATEWAY ?? "http://158.28.1.80";
const PAGE_CODE = "12601010_apimanager";
const ACTION = "OpenAPI维护-合并请求";

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

const urls = JSON.parse(readFileSync(URLS, "utf8"));
const done = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const todo = Object.values(urls).filter((a) => a.apiuri && !done[a.pk]);
const batch = limit > 0 ? todo.slice(0, limit) : todo;
console.log(`withUri=${Object.keys(urls).length && todo.length + Object.keys(done).length} todo=${batch.length} delay=${delay}ms`);

const simplifyParams = (list, isRequest) =>
  (list ?? []).map((p) => ({
    name: p.paramname,
    type: p.paramtype,
    required: p.isrequired,
    desc: p.description || null,
    parent: p.pid || null,
    seq: p.seqnum,
  }));

async function requestDoc(pk, attempt = 1) {
  const ts = Date.now();
  try {
    const r = await fetch(`${GATEWAY}/nccloud/opm/apimanager/QueryModalCardAction.do`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        Cookie: jar,
        cookiets: String(ts),
        transcode: "12601010",
        crux: String(ts),
      },
      body: JSON.stringify({
        busiParamJson: JSON.stringify({ pageCode: PAGE_CODE, formId: "modal_form", tableId: ["modal_request"], pk }),
        sysParamJson: { busiaction: ACTION, appcode: "12601010", tabid: "", ts, from: "", pagecs: String(ts) },
      }),
      signal: AbortSignal.timeout(30000),
    });
    return await r.json();
  } catch (e) {
    if (attempt >= 3) throw e;
    await new Promise((res) => setTimeout(res, 2000 * attempt));
    return requestDoc(pk, attempt + 1);
  }
}

const save = () => {
  writeFileSync(OUT + ".tmp", JSON.stringify(done, null, 1));
  renameSync(OUT + ".tmp", OUT);
};

let ok = 0, fail = 0;
for (const api of batch) {
  try {
    const j = await requestDoc(api.pk);
    if (j.error) {
      fail++;
      done[api.pk] = { pk: api.pk, error: j.error.message };
    } else {
      const d = j?.data?.externalData ?? {};
      done[api.pk] = {
        pk: api.pk,
        apiuri: d.baseInfo?.apiuri ?? api.apiuri,
        requestExample: d.requestExample ?? null,
        responseExample: d.responseExample ?? null,
        requestParam: simplifyParams(d.requestParam, true),
        responseParam: simplifyParams(d.responseParam, false),
        errorCodes: d.errorCodes ?? null,
      };
      ok++;
    }
  } catch (e) {
    fail++;
    done[api.pk] = { pk: api.pk, error: String(e).slice(0, 120) };
  }
  if ((ok + fail) % 25 === 0) {
    save();
    console.log(`progress ${ok + fail}/${batch.length} ok=${ok} fail=${fail}`);
  }
  await new Promise((res) => setTimeout(res, delay));
}
save();
console.log(`DONE ok=${ok} fail=${fail} saved=${Object.keys(done).length}`);
