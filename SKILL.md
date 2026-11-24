---
name: yonbip-skill
description: 用友 YonBIP 高级版（NC Cloud）开发助手：数据字典查询（表/字段/引用/枚举，13 万表离线查）+ OpenAPI 调用（OPM 认证、业务接口取数、接口目录搜索）。做二开、联调、查数时先用字典确认结构，再用 OpenAPI 拉真实数据。
---

# YonBIP 开发助手

一个 skill，两个 CLI：

| CLI | 路径 | 用途 |
|---|---|---|
| yonbip-dict | `src/cli.ts` | 数据字典离线查询（数据已打包在 `data/`） |
| yonbip-api | `openapi/src/cli.ts` | OpenAPI 认证 + 业务接口调用 |

两者配合使用：先用字典搞清楚表结构/字段含义，再用 OpenAPI 取真实数据。

**安装**：`pi install git:github.com/r1cardohj/yonbip-skill`（零构建，Node >= 22.18）。
**数据初始化（自动）**：表/模块索引随包可用；字段数据走 Git LFS，
首次执行 `fields`/`field` 时 CLI 检测到 LFS 指针会自动 `git lfs pull`（约 140MB），
失败则按其报错在 skill 目录手动执行。

---

# 一、yonbip-dict — 数据字典查询

数据源是 dict-browser 服务导出的 `yonbip3ddcr5` 版数据字典
（13099 张表 / 51 万字段 / 189 个模块），查询全部离线。

## 运行

以下 `<SKILL_DIR>` 指本 skill 的根目录（即 SKILL.md 所在目录），路径均相对它解析：

```bash
node <SKILL_DIR>/src/cli.ts <命令> [选项]
```

Node >= 22.18 原生执行 TypeScript，零依赖零构建。

## 命令速查

| 命令 | 用途 |
|---|---|
| `search <关键词> [--module <code>]` | 按表名/中文名/VO 类名/模块模糊搜表 |
| `table <表名\|id>` | 单表概览：中文名、VO 类、模块、主键、字段数 |
| `fields <表名\|id>` | 字段明细：类型、PK/必填、引用模型（带 id 可跳转）、枚举值 |
| `field <字段名>` | 全局反查：该字段出现在哪些表（需先 `sync --fields`） |
| `modules` | 模块清单及表数量 |
| `info` | 本地缓存状态 |

所有命令支持 `--json` 输出结构化结果，`--limit` 控制条数。

## 典型工作流

1. 知道业务含义不知道表名：`search 销售订单`，按模块和字段数缩小范围。
2. 确认表结构：`fields so_saleorder`。
3. 外键看不懂：`fields` 输出里 `引用: xxx [id]` 的 id 可直接再喂给
   `fields <id>` 或 `table <id>` 跳到被引用表（客户、组织、单据类型等）。
4. 写 SQL 时反查字段归属：`field pk_org --limit 20`。

## 读字段输出的约定

- `PK 必填` = 主键且非空；`可空` = nullable。
- `引用: 组织_业务单元_销售组织(salesorg) [75ba9a0nxd]` —— 括号内是引用模型
  code，方括号内是该模型在字典中的 id，可继续用 `fields <id>` 展开。
- `枚举:` 行是字段取值范围（如 `-1=平台级; 0=领域级; ...`）。
- `类型: 主键 (UFID)` / `类型: 字符串 (String)` 表示基础类型，无引用模型。

---

# 二、yonbip-api — OpenAPI 调用

针对 YonBIP 高级版（NC Cloud OPM 开放平台）。认证算法与官方 SDK
（`nccloud.open.api.auto.token.cur.utils`，2105+ 版本）一致。

## 运行

```bash
node <SKILL_DIR>/openapi/src/cli.ts <命令> [选项]
```

要求同上：Node >= 22.18，直接运行。

## 前置条件（OPM 侧，一次性）

- 管理员在【OpenAPI应用管理】创建第三方应用并绑定用户（user_code）
- 【关联API】勾选应用允许调用的接口 —— 未关联的接口报"没有权限"
- 拿到四要素：应用编码、应用密文、公钥、账套编码

## 命令速查

| 命令 | 用途 |
|---|---|
| `auth login --gateway <url> --app-id <id> --app-secret <s> --pub-key <k> --biz-center <c>` | 配置凭证并取 token（存 `~/.config/yonbip-api/`，600 权限） |
| `auth status` / `auth refresh` / `auth logout` | token 状态 / 强制刷新 / 删除配置 |
| `apis <关键词>` | 在接口目录（2156 个接口）中搜索，直接给出真实请求路径 |
| `doc <关键词\|pk>` | 查接口文档：真实 URL、请求示例、参数表（本地缓存的 OPM 文档） |
| `refs <档案> <关键词>` | 按名称/编码查档案主数据，返回 pk / code / name（名字 → pk 解析） |
| `refs types` | 列出 refs 支持的档案类型及映射状态 |
| `call <path> [--body '<json>'\|@file]` | 调 OpenAPI（POST），自动带认证头 |
| `token` | 打印当前 access_token |

## 典型工作流

```bash
# 1. 登录（一次性，token 有效期约 11 天，自动刷新）
node openapi/src/cli.ts auth login --gateway http://<host>:<port> \
  --app-id <应用编码> --app-secret <应用密文> --pub-key <公钥> --biz-center <账套编码>

# 2. 找接口（apis 直接给真实 URL）
node openapi/src/cli.ts apis 现存量
# → 0001Z8100000000DJ1ZH  /nccloud/api/ic/onhand/onhandQuery
#    40081301 查询现存量 — 40 供应链/…

# 拿请求体格式：doc 看请求示例
node openapi/src/cli.ts doc 1001Z010000000008HBM

# 3. 调接口（业务参数必填项报错就按提示补，如 pk_org / cmaterialoid）
#    档案 pk 先用 refs 按名字解析：
node openapi/src/cli.ts refs org 华东          # 组织/业务单元按名称模糊查
node openapi/src/cli.ts refs --ref 75ba9a0nxd 华东   # --ref 直接吃 fields 输出的引用模型 id
node openapi/src/cli.ts refs material --code M001    # 按编码精确查
node openapi/src/cli.ts refs types                   # 看支持哪些档案

node openapi/src/cli.ts call ic/onhand/onhandQuery \
  --body '{"pk_org":"<组织pk>","cmaterialoid":"<物料pk>","page":{"pageIndex":0,"pageSize":10}}'
```

## 注意事项

- **接口路径**：`call` 的 path 参数相对 `nccloud/api`，真实路径用 `apis` 查
  （数据来自 OPM 接口维护，不是推断），请求体格式用 `doc` 看示例。
- **请求体结构**：档案类查询多为 `{"ufinterface":{"sender":"default","data":{…条件, pageInfo}}}`
  —— 查询条件嵌在 `ufinterface.data` 里，放顶层会报 `ufinterface:null`。各接口
  结构不完全一致，以 `doc` 输出为准。
- **权限**：`call` 报"第三方应用没有 xxx 的权限" → 去 OPM 给应用关联该 API。
- **业务参数**：报"字段:xxx为必输项"是正常的业务校验，按提示补参数即可；
  组织/物料/客户等档案 pk 用 `refs` 命令按名称解析（见下节）。
- **凭证安全**：四要素等价于账号密码，不要写进代码/文档/版本库；
  已配置的凭证在 `~/.config/yonbip-api/config.json`，勿提交。

## refs —— 名字 → pk 参照解析

call 报"pk_org 为必输"时不用再干瞪眼：`refs` 按名称/编码模糊查档案主数据，
返回 `pk / code / name`，取 pk 直接填 call 参数。

```bash
node openapi/src/cli.ts refs org 华东          # 组织（含集团/财务/库存/销售等职能组织）
node openapi/src/cli.ts refs 客户 华为          # 中文别名也行
node openapi/src/cli.ts refs --ref 75ba9a0nxd 华东  # 直接吃字典 fields 输出的 [引用模型 id]
node openapi/src/cli.ts refs material --code M001   # 按编码精确查
node openapi/src/cli.ts refs psndoc 姚 --org <组织pk>        # 人员接口必填业务单元
node openapi/src/cli.ts refs user 周 --org 1000              # 用户接口的 pk_org 要组织编码
node openapi/src/cli.ts refs --json ...             # 结构化输出
node openapi/src/cli.ts refs types                  # 看每类档案的接口/验证状态/必填参数
```

要点：

- 映射表 `openapi/data/ref-map.json`：引用模型（字典 refId/表名/中文别名）→ 接口目录
  里的查询接口（pk + 真实 path），覆盖 51 万字段里最高频的 23 类档案。
- path 取自 OPM 接口维护数据（`openapi/data/api-urls.json`），`verified: true` 表示
  已在真实环境调用通过，其余尚未做端到端调用（不等于路径错）。
- 请求体以 OPM 请求示例为模板（`openapi/data/api-docs.json`），再填 code/name/pageInfo。
  注意各接口必填条件不同：人员/物料/分类要 `--org`，且**有的接口 pk_org 填主键、
  有的要填组织编码**（`refs types` 会标注），传错报「参数pk_org数据在系统中不存在」。
- 名称条件多数是精确匹配：`refs` 服务端查不到时会自动去掉条件拉一批再本地模糊过滤。
- 调用失败时可用 `doc <pk>` 看请求示例，或写 `~/.config/yonbip-api/ref-map.json`
  覆盖（同键条目字段级合并，也可加全新档案）。
- 目录中没有查询接口的档案（单据类型、币种、仓库等），`refs` 会说明原因并给出
  相关接口建议；这类 pk 需登录界面或用其他条件查询接口获取。

---

# 三、通用注意事项

- 上下文纪律：字典有 13 万张表、接口目录 2000+，绝对不要把清单全量读进上下文，
  一律 CLI 按需查询（默认 30 条以内），`--json` 供脚本精确解析。
- 查表/找接口优先模糊搜索拿候选 → 确认后再看明细；不要猜名字直接查。
- 字典版本 yonbip3ddcr5（BIP 3.x / NC Cloud 2312），与其他版本可能有差异。
- 字典数据目录默认 skill 内置 `data/`，可用 `YONBIP_DICT_HOME` 覆盖；版本升级时
  用 `sync` / `sync --fields` 重新生成（数据源地址用 `--base` 或 `YONBIP_DICT_BASE` 传入）。
