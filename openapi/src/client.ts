import { ensureToken, sign } from "./auth.ts";
import { activeProfile, loadConfig, type Profile } from "./config.ts";

// 业务接口 header 约定与官方 SDK getAPIRetrun 一致：
// access_token / client_id / signature / repeat_check=Y / ucg_flag=y
export async function callApi(
  path: string,
  body?: unknown
): Promise<unknown> {
  const cfg = loadConfig();
  if (!cfg?.active || !cfg.profiles[cfg.active]) {
    throw new Error("未登录，请先运行 yonbip-api auth login");
  }
  const p: Profile = cfg.profiles[cfg.active];
  const token = await ensureToken(cfg.active, p);

  const json = body === undefined ? "" : JSON.stringify(body);
  const signature = sign(p.appId + json + p.pubKey, p.pubKey);

  const url = `${p.gateway}/nccloud/api/${path.replace(/^\//, "")}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      access_token: token,
      client_id: p.appId,
      signature,
      repeat_check: "Y",
      ucg_flag: "y",
      "Content-Type": "application/json;charset=utf-8",
    },
    body: json || undefined,
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`接口返回非 JSON（HTTP ${res.status}）: ${text.slice(0, 300)}`);
  }
}

export function checkBusinessError(body: unknown): void {
  const b = body as { success?: boolean; code?: string; message?: string | null };
  if (b && typeof b === "object" && "success" in b && b.success === false) {
    throw new Error(`接口错误 [${b.code}]: ${b.message}`);
  }
}

export { activeProfile };
