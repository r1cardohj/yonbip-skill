import { existsSync } from "node:fs";
import { baseUrl, detailUrl, paths, readJson, writeJson } from "./store.js";
import type { ParsedRef, TableDetail } from "./types.js";

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return (await res.json()) as T;
}

export async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

export async function getDetail(base: string | undefined, id: string): Promise<TableDetail> {
  const cached = paths.detailFile(id);
  if (existsSync(cached)) {
    return readJson<TableDetail>(cached);
  }
  const detail = await fetchJson<TableDetail>(detailUrl(baseUrl(base), id));
  writeJson(cached, detail);
  return detail;
}

// refClassPathHref 形如 '<a href="javascript:void(0);" onClick=loadDataDict("f10pl1znl4");>应用资产类型</a> (assettype)'
// 纯文本时形如 '字符串 (String)'
export function parseRef(html: string | undefined): ParsedRef {
  if (!html) return { refId: "", refName: "", refCode: "" };
  const idMatch = /loadDataDict\("([^"]+)"\)/.exec(html);
  const text = html.replace(/<[^>]*>/g, "").trim();
  const codeMatch = /\(([^()]*)\)\s*$/.exec(text);
  return {
    refId: idMatch?.[1] ?? "",
    refName: idMatch ? text.replace(/\s*\([^()]*\)\s*$/, "").trim() : text,
    refCode: codeMatch?.[1] ?? "",
  };
}

export function cleanScope(scope: string | undefined): string {
  return (scope ?? "").replace(/<br\s*\/?>/gi, "; ").trim();
}
