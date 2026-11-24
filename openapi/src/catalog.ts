import { readFileSync } from "node:fs";
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
  const docs = readJson<Record<string, ApiDoc>>("api-docs.json");
  return docs?.[pk];
}
