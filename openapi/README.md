# openapi/ — yonbip-api 实现目录

yonbip-skill 的 OpenAPI 子 CLI（认证 + 业务接口调用 + 接口目录搜索）。
**使用说明见项目根目录的 [SKILL.md](../SKILL.md)**，此处只记录实现细节。

## 构建

```bash
npm install && npm run build   # 产物在 dist/
```

## 认证算法（与官方 SDK `nccloud.open.api.auto.token.cur.utils` 一致）

- **token 端点**：`POST {gateway}/nccloud/opm/accesstoken`，参数在 query，
  Content-Type 必须为 `application/x-www-form-urlencoded`
- **client_secret**：`RSA/ECB/OAEPWithSHA-256AndMGF1Padding` 加密应用密文 → Base64
  （2105 之前的旧版是 PKCS1Padding，勿混用）
- **signature**：`SHA256(client_id + client_secret + pubKey + salt)` 小写 hex，
  其中 `salt = Base64(SHA1(SHA1(pubKey))[0:16])`
  （sun.security.provider.SecureRandom SHA1PRNG setSeed 的确定性展开，纯 Node 实现，
  见 `src/auth.ts`）
- **业务接口 header**：`access_token` / `client_id` / `signature` /
  `repeat_check: Y` / `ucg_flag: y`；业务调用的签名字符串为 `client_id + json_body + pubKey`

## 数据

- `data/api-catalog.json` — 接口目录（2156 个接口的 pk/名称/层级），`apis` 命令用。
  来源：环境 OPM 导出，可用 `POST /nccloud/opm/thirdapp/LoadAPIVOAction.do` 重新生成。
