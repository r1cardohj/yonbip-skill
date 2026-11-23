---
name: yonbip-skill
description: 用友 YonBIP 高级版（NC Cloud）开发助手：数据字典查询（表/字段/引用/枚举，13 万表离线查）+ OpenAPI 调用（OPM 认证、业务接口取数、接口目录搜索）。做二开、联调、查数时先用字典确认结构，再用 OpenAPI 拉真实数据。
---

# YonBIP 开发助手

一个 skill，两个 CLI：

| CLI | 路径 | 用途 |
|---|---|---|
| yonbip-dict | `dist/cli.js` | 数据字典离线查询（数据已打包在 `data/`） |
| yonbip-api | `openapi/dist/cli.js` | OpenAPI 认证 + 业务接口调用 |

两者配合使用：先用字典搞清楚表结构/字段含义，再用 OpenAPI 取真实数据。

---

# 一、yonbip-dict — 数据字典查询

数据源是 dict-browser 服务导出的 `yonbip3ddcr5` 版数据字典
（13099 张表 / 51 万字段 / 189 个模块），查询全部离线。

## 运行

以下 `<SKILL_DIR>` 指本 skill 的根目录（即 SKILL.md 所在目录），路径均相对它解析：

```bash
node <SKILL_DIR>/dist/cli.js <命令> [选项]
```

若 `dist/` 不存在或改过 `src/`，先 `npm run build`（tsc）。

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
node <SKILL_DIR>/openapi/dist/cli.js <命令> [选项]
```

若 `openapi/dist/` 不存在或改过 `openapi/src/`，先在 `openapi/` 下 `npm run build`。

## 前置条件（OPM 侧，一次性）

- 管理员在【OpenAPI应用管理】创建第三方应用并绑定用户（user_code）
- 【关联API】勾选应用允许调用的接口 —— 未关联的接口报"没有权限"
- 拿到四要素：应用编码、应用密文、公钥、账套编码

## 命令速查

| 命令 | 用途 |
|---|---|
| `auth login --gateway <url> --app-id <id> --app-secret <s> --pub-key <k> --biz-center <c>` | 配置凭证并取 token（存 `~/.config/yonbip-api/`，600 权限） |
| `auth status` / `auth refresh` / `auth logout` | token 状态 / 强制刷新 / 删除配置 |
| `apis <关键词>` | 在接口目录（2156 个，`openapi/data/api-catalog.json`）中搜索 |
| `call <path> [--body '<json>'\|@file]` | 调 OpenAPI（POST），自动带认证头 |
| `token` | 打印当前 access_token |

## 典型工作流

```bash
# 1. 登录（一次性，token 有效期约 11 天，自动刷新）
node openapi/dist/cli.js auth login --gateway http://<host>:<port> \
  --app-id <应用编码> --app-secret <应用密文> --pub-key <公钥> --biz-center <账套编码>

# 2. 找接口
node openapi/dist/cli.js apis 现存量
# → 0001Z8100000000DJ1ZH  40 供应链/4008 库存管理/400813 库存存量/40081301 查询现存量

# 3. 调接口（业务参数必填项报错就按提示补，如 pk_org / cmaterialoid）
node openapi/dist/cli.js call ic/onhand/onhandQuery \
  --body '{"pk_org":"<组织pk>","cmaterialoid":"<物料pk>","page":{"pageIndex":0,"pageSize":10}}'
```

## 注意事项

- **接口路径**：业务接口形如 `nccloud/api/{模块}/{组件}/{资源}/{动词}`，`call` 的
  path 参数相对 `nccloud/api`。具体路径和必填字段在 OPM 的接口文档里查
  （`apis` 命令只能按名称定位接口）。
- **权限**：`call` 报"第三方应用没有 xxx 的权限" → 去 OPM 给应用关联该 API。
- **业务参数**：报"字段:xxx为必输项"是正常的业务校验，按提示补参数即可；
  组织/物料等 pk 值可先登录系统界面或用已关联的查询类接口获取。
- **凭证安全**：四要素等价于账号密码，不要写进代码/文档/版本库；
  已配置的凭证在 `~/.config/yonbip-api/config.json`，勿提交。

---

# 三、通用注意事项

- 上下文纪律：字典有 13 万张表、接口目录 2000+，绝对不要把清单全量读进上下文，
  一律 CLI 按需查询（默认 30 条以内），`--json` 供脚本精确解析。
- 查表/找接口优先模糊搜索拿候选 → 确认后再看明细；不要猜名字直接查。
- 字典版本 yonbip3ddcr5（BIP 3.x / NC Cloud 2312），与其他版本可能有差异。
- 字典数据目录默认 skill 内置 `data/`，可用 `YONBIP_DICT_HOME` 覆盖；版本升级时
  用 `sync` / `sync --fields` 重新生成（数据源地址用 `--base` 或 `YONBIP_DICT_BASE` 传入）。
