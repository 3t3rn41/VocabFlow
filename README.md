# VocabFlow

一个本地化优先的词汇与句子间隔重复学习应用，包含 **React 前端 + Express + MySQL 后端**。

> 核心功能已完成：单词 SRS 复习、句子拼写练习、学习统计、多词书管理。所有词书数据来自本地 JSON 文件，无需外部 API。

## 功能概览

### 单词学习（SRS 间隔重复）

- **FSRS-4.5 算法**（`ts-fsrs`）：比传统 SM-2 更精准的间隔预测
- 卡片翻转复习流程 + **3 键 / 4 键**评分布局
- 键盘快捷键：`Space` 翻转、`1/2/3/4` 评分、`Ctrl+Z` 撤销
- 每日新词上限可控，复习队列自动混合到期卡片与新词
- 难点词自动重排优先复习

### 句子拼写练习（中译英）

- 雅思日常对话 **6 个 Band、710 句**，按 Band → Topic → Dialogue 三级组织
- 逐词输入模型：每个单词一个词槽，标点直接显示不占位
- 智能判定：大小写不敏感、`Backspace` 回退、`Tab` 揭示一个字母（渐进提示）、`Space` 跳转、`Enter` 自动进入下一句
- 反馈动画：正确撒花勾选、错误抖动、连击计数
- 进度持久化：刷新后恢复到上次练习位置

### 学习统计

- 今日进度环形图 + 已学单词 / 复习次数 / 坚持天数
- 近 30 天柱状图、SRS 状态分布、词汇量估计

### 多词书

| 词书 | ID | 类型 | 数量 |
|---|---|---|---|
| 高考核心词汇 | `gaokao` | 单词 | 3,429 |
| 雅思核心词汇 | `ielts` | 单词 | 605 |
| 雅思日常对话 | `ielts-sentences` | 句子 | 710 |

切换词书后自动从 SRS 新词开始。

### 设置

- 主题（跟随系统 / 浅色 / 深色）
- FSRS 目标保留率、每日新词上限、键盘布局、复习随机化
- 自动朗读开关（浏览器 Speech Synthesis）
- 清除学习数据、词书切换

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 + TypeScript + Vite 8 + Tailwind CSS |
| 状态 | Zustand |
| 路由 | react-router-dom 7 |
| 图表 | Recharts |
| SRS | `ts-fsrs` (FSRS-4.5) |
| 后端 | Express + MySQL (`mysql2`) |
| ORM | 原生 SQL（`server/src/db.ts` 连接池） |
| 存储 | 前端 IndexedDB（`idb-keyval`）+ 后端 MySQL |

## 项目结构

```
VocabFlow/
├── src/                       # 前端 (React)
│   ├── api/                   # 后端 API 封装 (srs / sentences / user)
│   ├── components/
│   │   ├── layout/            # AppLayout / Sidebar / Topbar
│   │   ├── review/            # FlashCard / GradeButtons / ProgressRing
│   │   ├── ui/                # Button / Input / Spinner / Toast
│   │   └── word/              # PronunciationButton
│   ├── data/                  # 词书加载 (gaokao / ielts / ielts-sentences)
│   ├── pages/                 # Today / Review / Words / WordDetail / Sentences / Settings / WordBookSelection
│   ├── srs/                   # SRS 引擎 (ts-fsrs 封装)
│   ├── stores/                # Zustand store (settings / ui / wordBook)
│   ├── types/                 # TypeScript 类型定义
│   ├── hooks/                 # 应用初始化 (数据加载)
│   └── utils/                 # 常量 / 存储 / 日期
├── server/                    # 后端 (Express + MySQL)
│   └── src/
│       ├── db.ts              # mysql2 连接池
│       ├── index.ts           # 入口 + 路由挂载
│       ├── srs.ts             # SRS 调度逻辑
│       ├── routes/
│       │   ├── srs.ts         # /api/srs
│       │   ├── sentences.ts   # /api/sentences
│       │   └── user.ts        # /api/user
│       └── srs.ts
├── data/                      # 词书 JSON 数据
│   ├── gaokao_words.json      # 高考词汇 (3,429)
│   ├── IELTS_words.json       # 雅思词汇 (605)
│   └── IELTS_sentences.json   # 雅思句子 (710)
├── vocabflow.sql              # MySQL 建库建表脚本
└── vite.config.ts             # Vite 配置 + /api 代理到 :3001
```

## 快速开始

### 环境要求

- Node.js ≥ 18
- MySQL ≥ 8.0

### 1. 安装依赖

```bash
npm install                          # 前端依赖
cd server && npm install && cd ..    # 后端依赖
```

### 2. 初始化数据库

启动 MySQL，然后执行 `vocabflow.sql`：

```bash
mysql -u root -p < vocabflow.sql
```

> **注意**：`vocabflow.sql` 为项目演进过程中的快照，后端实际表结构请以 `server/src/` 中的迁移逻辑为准；如遇冲突，可清空数据库后重新执行后端自动建表。

### 3. 配置后端（可选）

后端默认连接本地 MySQL，可通过环境变量覆盖：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DB_HOST` | `127.0.0.1` | 数据库地址 |
| `DB_PORT` | `3306` | 数据库端口 |
| `DB_USER` | `root` | 数据库用户 |
| `DB_PASSWORD` | *(空)* | 数据库密码 |
| `DB_NAME` | `vocabflow` | 数据库名 |
| `PORT` | `3001` | 后端监听端口 |

### 4. 启动开发环境

```bash
npm run dev:all         # 同时启动前端 (Vite :5173) + 后端 (Express :3001)
```

或分开启动：

```bash
npm run dev             # 前端 → http://localhost:5173
npm run server          # 后端 → http://localhost:3001
```

前端 dev server 通过 `/api` 代理将请求转发到后端，无需额外 CORS 配置。

### 5. 构建生产版本

```bash
npm run build           # 前端构建到 dist/
npm run preview         # 预览生产构建
npm test                # 运行单元测试
```

## API 路由

| 路由 | 说明 |
|---|---|
| `GET  /api/srs/cards` | 获取全部 SRS 卡片 |
| `POST /api/srs/review` | 提交一次复习评分 |
| `GET  /api/sentences/progress` | 获取句子练习进度 |
| `POST /api/sentences/progress` | 更新句子练习进度 |
| `GET  /api/user/settings` | 获取用户设置 |
| `POST /api/user/settings` | 保存用户设置 |
| `GET  /api/health` | 健康检查（含数据库连通性） |

完整路由签名见 `server/src/routes/`。

## 设计决策

1. **双存储策略**：前端用 IndexedDB（`idb-keyval`）缓存词书与离线数据，MySQL 负责持久化 SRS 卡片、复习日志与用户设置，保证刷新与设备间一致。
2. **FSRS-4.5**：替代传统 SM-2，基于三组件记忆模型预测每张卡形的最佳复习时机，平衡记忆负担与保留率。
3. **纯本地词书数据**：移除所有外部 API 依赖（原架构依赖墨墨 Open API / 小米墨墨 TTS），数据来自本地 JSON，可完全离线使用。
4. **句子拼写 UX**：逐词槽输入 + 自动跳转，相比整句输入降低认知负担；渐进式提示（每次揭示一个字母）引导回忆。

## 已知限制

- 浏览器 Speech Synthesis 的语音质量因系统和浏览器而异。
- 切换词书会重置 SRS 新词队列（不自动迁移已有卡片状态）。
- 词书范围固定（高考 / 雅思），暂不支持自定义词书或导入。
- 句子练习暂未集成 SRS 调度。

## 路线图

- [x] MySQL 后端 + Express API
- [x] FSRS-4.5 SRS 引擎
- [x] 句子拼写练习 + 进度持久化
- [x] 多词书支持（单词 / 句子）
- [x] 学习统计与图表
- [ ] 句子练习 SRS 集成
- [ ] 移动端适配优化
- [ ] 学习数据导出 / 导入
- [ ] 自定义词书支持
- [ ] 单词听写模式
