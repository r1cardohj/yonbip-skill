import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface CatalogApi {
  pk: string;
  name: string;
  path: string;
}

export function loadCatalog(): CatalogApi[] {
  const dataFile = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "api-catalog.json");
  const raw = JSON.parse(readFileSync(dataFile, "utf8")) as {
    data: { refname?: string; nodeData?: { pk_api?: string; name?: string }; children?: unknown[] }[];
  };
  const out: CatalogApi[] = [];
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

export function searchCatalog(keyword: string, limit = 30): CatalogApi[] {
  const q = keyword.toLowerCase();
  return loadCatalog()
    .filter((c) => c.name.toLowerCase().includes(q) || c.path.toLowerCase().includes(q))
    .slice(0, limit);
}
