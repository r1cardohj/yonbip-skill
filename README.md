# yonbip-skill

用友 YonBIP 高级版（NC Cloud）开发助手 skill，供开发者与 AI Agent 使用：

- **yonbip-dict** — 数据字典查询 CLI（13099 张表 / 51 万字段，数据打包离线查）
- **yonbip-api** — OpenAPI CLI（OPM 认证 + 业务接口调用 + 接口目录搜索）

**Agent 使用说明见 [SKILL.md](./SKILL.md)**（含两个 CLI 的命令、工作流和注意事项）。

## 安装到 pi

```bash
pi install git:github.com/r1cardohj/yonbip-skill
```

零构建（Node >= 22.18 原生执行 TypeScript）。字典数据按需加载：

- 表/模块索引（3MB）随克隆立即可用：`search` / `table` / `modules` / `info`
- 字段数据（140MB，Git LFS）在**首次执行 `fields`/`field` 时自动** `git lfs pull`，无需手动
- 若自动拉取失败（如未装 git-lfs），按报错提示在 skill 目录手动 `git lfs pull`

OpenAPI 使用前需登录一次（凭证各配各的，存本机 `~/.config/yonbip-api/`）：

```bash
node openapi/src/cli.ts auth login \
  --gateway http://<host>:<port> --app-id <应用编码> \
  --app-secret <应用密文> --pub-key <公钥> --biz-center <账套编码>
```

## 安装到其他 Agent

不支持 `pi install` 时手动克隆（需 git-lfs，装后执行一次 `git lfs pull`）：

```bash
git clone https://github.com/r1cardohj/yonbip-skill.git
cd yonbip-skill
```
注册到各 Agent 的 skill 目录：
## 安装到其他 Agent


```bash
# Claude Code：个人级 skill
ln -s "$PWD" ~/.claude/skills/yonbip-skill

# OpenAI Codex CLI
ln -s "$PWD" ~/.codex/skills/yonbip-skill

# 项目级（随仓库走，团队成员共享）：在仓库内创建
mkdir -p .claude/skills && ln -s ../../ .claude/skills/yonbip-skill
```

通用原则：凡支持 SKILL.md 约定（skill 目录 + 前置元数据）的 Agent，
把整个仓库软链/复制到它的 skill 扫描目录即可；目录名就是 skill 名。

如果目标 Agent 不支持 SKILL.md，还有两条路：

1. **只用 CLI，不接 Agent**：两个 CLI 均可独立使用，克隆后 + auth login 即可；
2. **手动接规则**：把 [SKILL.md](./SKILL.md) 的内容粘贴到该 Agent 的规则/记忆
   配置里（如 Cursor 的 `.cursor/rules/`、自定义 system prompt），
   并把 CLI 绝对路径替换进去。

## 目录结构

```
├── SKILL.md            # skill 入口（唯一）
├── README.md
├── src/                # yonbip-dict（Node 直接执行，零构建）
├── data/               # 字典数据（索引 3MB 随包；字段 140MB 走 LFS 按需拉）
├── openapi/
│   ├── src/            # yonbip-api（Node 直接执行）
│   └── data/           # OpenAPI 接口目录（2156 个接口）
└── package.json
```

## 运行与开发

两个 CLI 均零依赖，Node >= 22.18 原生执行 TypeScript（类型剥离），无需构建：

```bash
node src/cli.ts <命令>           # yonbip-dict
node openapi/src/cli.ts <命令>   # yonbip-api
```

改源码后跑 `npm run typecheck`（tsc --noEmit）做类型检查即可，凭证存于用户目录（`~/.config/yonbip-api/`，
600 权限），不进入版本库。
