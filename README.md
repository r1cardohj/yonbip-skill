# yonbip-skill

用友 YonBIP 高级版（NC Cloud）开发助手 skill，供开发者与 AI Agent 使用：

- **yonbip-dict** — 数据字典查询 CLI（13099 张表 / 51 万字段，数据打包离线查）
- **yonbip-api** — OpenAPI CLI（OPM 认证 + 业务接口调用 + 接口目录搜索）

**Agent 使用说明见 [SKILL.md](./SKILL.md)**（含两个 CLI 的命令、工作流和注意事项）。

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
