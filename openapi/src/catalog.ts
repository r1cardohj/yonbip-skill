import { openSync, closeSync, readFileSync, readSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface CatalogApi {
  pk: string;
  name: string;
  path: string;
  /** 真实请求路径（相对 /nccloud/api），来自 OPM 接口维护数据 */
  apiuri?: string;
}

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(join(DATA, file), "utf8")) as T;
  } catch {
    return null;
  }
}

export function loadCatalog(): CatalogApi[] {
  const raw = readJson<{
    data: { refname?: string; nodeData?: { pk_api?: string; name?: string }; children?: unknown[] }[];
  }>("api-catalog.json");
  if (!raw) return [];
  const uris = readJson<Record<string, { apiuri?: string | null }>>("api-urls.json") ?? {};
  const out: CatalogApi[] = [];
  const walk = (nodes: typeof raw.data, prefix: string) => {
    for (const n of nodes) {
      const name = (n.nodeData?.name ?? n.refname ?? "").trim();
      const p = prefix ? `${prefix}/${name}` : name;
      if (n.children && n.children.length) walk(n.children as typeof raw.data, p);
      else if (n.nodeData?.pk_api) {
        const pk = n.nodeData.pk_api;
        out.push({ pk, name, path: p, apiuri: uris[pk]?.apiuri ?? undefined });
      }
    }
  };
  walk(raw.data, "");
  return out;
}

export function searchCatalog(keyword: string, limit = 30): CatalogApi[] {
  const q = keyword.toLowerCase();
  return loadCatalog()
    .filter((c) => c.name.toLowerCase().includes(q) || c.path.toLowerCase().includes(q) || c.pk === keyword)
    .slice(0, limit);
}

export interface ApiParam {
  name: string;
  type: string;
  required: boolean;
  desc: string | null;
  seq: string;
}

export interface ApiDoc {
  pk: string;
  apiuri: string | null;
  requestExample: string | null;
  responseExample: string | null;
  requestParam: ApiParam[];
  responseParam: ApiParam[];
  errorCodes: unknown;
}

export function loadApiDoc(pk: string): ApiDoc | undefined {
  const docs = readDocs();
  return docs?.[pk];
}

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

let lfsPullTried = false;

// api-docs.json 走 Git LFS；未装 git-lfs 克隆时落到本地的只是指针，先尝试拉取，失败就当作没有文档
function readDocs(): Record<string, ApiDoc> | null {
  const file = join(DATA, "api-docs.json");
  if (!existsSync(file)) return null;
  if (isLfsPointer(file)) {
    if (lfsPullTried) return null;
    lfsPullTried = true;
    const pulled = spawnSync("git", ["lfs", "pull", "--include", "openapi/data/api-docs.json"], {
      cwd: DATA,
      stdio: "inherit",
    });
    if (pulled.status !== 0 || isLfsPointer(file)) {
      console.error("（api-docs.json 是 Git LFS 指针，未安装 git-lfs 或拉取失败；接口文档不可用，可运行 npm run fetch:docs 重新导出）");
      return null;
    }
  }
  return readJson<Record<string, ApiDoc>>("api-docs.json");
}
