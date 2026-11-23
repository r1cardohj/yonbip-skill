// 认证算法与官方 SDK（nccloud.open.api.auto.token.cur.utils.APICurUtils）逐字节对齐：
// - salt = Base64(SHA1(SHA1(pubKey))[0:16])（sun.security.provider.SecureRandom SHA1PRNG 的确定性展开）
// - signature = SHA256(client_id + client_secret + pubKey + salt) 小写 hex
// - client_secret = RSA/ECB/OAEPWithSHA-256AndMGF1Padding(plain) → Base64 → URLencode
// - token 端点: {gateway}/nccloud/opm/accesstoken (grant_type=client_credentials)
import { createHash, publicEncrypt, constants } from "node:crypto";
import { updateProfile, type Profile } from "./config.js";

export function computeSalt(pubKey: string): string {
  const round1 = createHash("sha1").update(pubKey, "utf8").digest();
  const round2 = createHash("sha1").update(round1).digest();
  return round2.subarray(0, 16).toString("base64");
}

export function sign(params: string, pubKey: string): string {
  return createHash("sha256")
    .update(params + computeSalt(pubKey), "utf8")
    .digest("hex");
}

export function encryptSecret(appSecret: string, pubKey: string): string {
  const pem = `-----BEGIN PUBLIC KEY-----\n${pubKey.match(/.{1,64}/g)!.join("\n")}\n-----END PUBLIC KEY-----`;
  const encrypted = publicEncrypt(
    {
      key: pem,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(appSecret, "utf8")
  );
  return encrypted.toString("base64");
}

interface TokenResponse {
  success?: boolean;
  code?: string;
  message?: string | null;
  data?: {
    access_token?: string;
    security_key?: string;
    expires_in?: number;
    security_level?: string;
  };
}

// token 提前 5 分钟视为过期
const REFRESH_WINDOW_MS = 5 * 60 * 1000;

export function tokenUsable(p: Profile): boolean {
  return Boolean(p.token && p.token.expiresAt - REFRESH_WINDOW_MS > Date.now());
}

export async function fetchToken(p: Profile): Promise<{ value: string; securityKey: string; expiresAt: number }> {
  const signature = sign(p.appId + p.appSecret + p.pubKey, p.pubKey);
  // client_secret 的 base64 由 URLSearchParams 统一编码，勿提前 encode
  const qs = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: p.appId,
    client_secret: encryptSecret(p.appSecret, p.pubKey),
    biz_center: p.bizCenter,
    signature,
  }).toString();
  const url = `${p.gateway}/nccloud/opm/accesstoken?${qs}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const text = await res.text();
  let body: TokenResponse;
  try {
    body = JSON.parse(text) as TokenResponse;
  } catch {
    throw new Error(`token 接口返回非 JSON（HTTP ${res.status}）: ${text.slice(0, 200)}`);
  }
  const token = body.data?.access_token;
  if (!res.ok || !body.success || !token) {
    throw new Error(`获取 token 失败 (HTTP ${res.status}) [${body.code}]: ${body.message ?? text.slice(0, 200)}`);
  }
  const expiresIn = body.data?.expires_in ?? 1000000;
  return {
    value: token,
    securityKey: body.data?.security_key ?? "",
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

export async function ensureToken(profileName: string, p: Profile, force = false): Promise<string> {
  if (!force && tokenUsable(p)) return p.token!.value;
  const token = await fetchToken(p);
  updateProfile(profileName, {
    token: { value: token.value, expiresAt: token.expiresAt },
    securityKey: token.securityKey,
  });
  return token.value;
}
