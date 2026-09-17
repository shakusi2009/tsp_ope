# tsp_ope
## 车联网运营管理平台

本仓库当前提供一个本地可运行的后台管理平台基础工程：

- `apps/web`：Vite + React 前端骨架。
- `apps/api`：Express + TypeScript 本地 API。
- `data/tsp_ope.sqlite`：本地 SQLite 数据库文件，首次初始化时自动创建。

### 环境要求

- Node.js >= 22.5.0。API 使用 Node 内置 `node:sqlite` 访问 SQLite。
- npm >= 10。

### 本地启动

```bash
npm install
npm run db:init
npm run dev
```

默认地址：

- 前端：http://localhost:5173
- API：http://localhost:3001

### 常用命令

```bash
npm run db:init
npm run check
npm run build
```

### SQLite 配置

默认数据库路径是 `data/tsp_ope.sqlite`。如需调整，可设置环境变量：

```bash
SQLITE_PATH=/absolute/path/to/tsp_ope.sqlite npm run db:init
```

初始化脚本会创建基础身份与权限表，并写入后续登录任务所需的 `admin` 基础账号数据。
