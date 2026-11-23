# yonbip-skill

用友 YonBIP 高级版（NC Cloud）开发助手 skill，供开发者与 AI Agent 使用：

- **yonbip-dict** — 数据字典查询 CLI（13099 张表 / 51 万字段，数据打包离线查）
- **yonbip-api** — OpenAPI CLI（OPM 认证 + 业务接口调用 + 接口目录搜索）

**Agent 使用说明见 [SKILL.md](./SKILL.md)**（含两个 CLI 的命令、工作流和注意事项）。
**Agent 使用说明见 [SKILL.md](./SKILL.md)**（含两个 CLI 的命令、工作流和注意事项）。

## 安装到 pi

```bash
# 1. 克隆（含 LFS 数据，字典 168MB）
git lfs install   # 首次使用 LFS 需要先装 git-lfs
git clone https://github.com/r1cardohj/yonbip-skill.git
cd yonbip-skill

# 2. 构建两个 CLI（dist/ 不入库，必须本地构建；Node >= 20）
npm install && npm run build
cd openapi && npm install && npm run build && cd ..

# 3. 注册为 pi skill：软链到 pi 的 skill 扫描目录（路径按你的 pi 配置调整）
ln -s "$PWD" ~/project/agent-stuff/skills/yonbip-skill

# 4. 验证
node dist/cli.js table so_saleorder          # 字典：离线查表
node openapi/dist/cli.js --help              # OpenAPI CLI
```

OpenAPI 使用前还需登录一次（凭证各配各的，存本机 `~/.config/yonbip-skill/../yonbip-api/`）：

```bash
node openapi/dist/cli.js auth login \
  --gateway http://<host>:<port> --app-id <应用编码> \
  --app-secret <应用密文> --pub-key <公钥> --biz-center <账套编码>
```

pi 新会话即自动加载 `yonbip-skill`。
pi 新会话即自动加载 `yonbip-skill`。

## 安装到其他 Agent

第 1、2 步（克隆 + 构建）与上面相同，区别在于 skill 注册目录：

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

1. **只用 CLI，不接 Agent**：两个 CLI 均可独立使用，上面的构建 + auth login 即可；
2. **手动接规则**：把 [SKILL.md](./SKILL.md) 的内容粘贴到该 Agent 的规则/记忆
   配置里（如 Cursor 的 `.cursor/rules/`、自定义 system prompt），
   并把 CLI 绝对路径替换进去。

## 目录结构

```
├── SKILL.md            # skill 入口（唯一）
├── README.md
├── src/                # yonbip-dict 源码
├── dist/               # yonbip-dict 构建产物（tsc）
├── data/               # 字典数据（约 168MB，随 skill 打包）
├── openapi/
│   ├── src/            # yonbip-api 源码
│   ├── dist/           # yonbip-api 构建产物
│   └── data/           # OpenAPI 接口目录（2156 个接口）
└── package.json
```

## 构建

```bash
npm install && npm run build          # yonbip-dict
cd openapi && npm install && npm run build   # yonbip-api
```

两个 CLI 均零运行时依赖（Node >= 20），凭证存于用户目录（`~/.config/yonbip-api/`，
600 权限），不进入版本库。
