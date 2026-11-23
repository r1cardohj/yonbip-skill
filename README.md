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
