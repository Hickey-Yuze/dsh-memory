# dsh-memory

**DeepSeek Harness 的分层蒸馏长期记忆插件（精简自研版，架构对齐 [dsh-layered-memory](https://github.com/JunNanLYS/dsh-layered-memory)）。**

对话在后台自动完成 **L0 捕获 → L1 原子记忆 → L2 场景整合 → L3 画像蒸馏**，模型每轮回答前自动注入相关记忆；提供记忆检索工具与五区记忆工作台。零原生依赖、零外部服务，蒸馏复用宿主自己的 LLM。

## 工作原理

```
会话事件 (session/event)
   │  user/message / assistant/message（跳过插件合成消息）
   ▼
L0 conversations/<sid>.jsonl  ← 事实源，只增不改
   │  阈值爬坡（1→2→4…上限 minMessages）或闲置兜底触发
   ▼
L1 records.json     原子记忆抽取 + 相似候选去重合并        （ctx.llm）
   │  新记忆 ≥ minNewMemories
   ▼
L2 scenes.json      场景块整合（markdown 浓缩 + 记忆归类）   （ctx.llm）
   │  新记忆 ≥ interval
   ▼
L3 persona.json     用户核心画像滚动更新                    （ctx.llm）

召回：agent/pre-step 第一步（新用户消息之后）检索 L1，
     按「精度×覆盖」评分 + 时效衰减挑 Top-N，预算内合成 <recalled-memory> 消息注入。
稳定区：画像 <user-persona> 与场景导航 <scene-navigation> 走 systemPrompt.section（动态文本，空即省略）。
```

## 组件

- **三个记忆工具**（`ctx.tools`）：`memory_search`（L1 检索）、`conversation_search`（L0 跨会话检索）、`memory_read_scene`（L2 场景全文）
- **设置页「记忆」工作台**（五区，对齐原版布局）：总览 / 记忆库 / 自动化 / 洞察 / 维护
- **HTTP 数据面**：`/api-memory/health|overview|assets|config|insights|logs|rebuild|records/delete|wipe|scenes`
- **全量重建**：丢弃 L1–L3 从 L0 重导（进度可视、可取消）；`/compact` 压缩后召回去重自动重置

## 存储（`~/.dsh/dsh-memory/`，与原版 dsh-layered-memory 的 `~/.dsh/memory` 互相独立）

> 注：本插件装在 desktop profile；web profile 若装有原版 dsh-layered-memory，两者数据目录互不干扰。

| 文件 | 内容 |
|---|---|
| `conversations/<sid>.jsonl` | L0 会话事实源（含 cwd 元数据行） |
| `records.json` / `scenes.json` / `persona.json` | L1 / L2 / L3 资产 |
| `state.json` | 蒸馏水位、统计、重建进度 |
| `activity.jsonl` / `usage.jsonl` | 资产活动流 / 蒸馏记账（成本与失败） |
| `config.json` | 设置页写入的运行时覆盖（节级合并到 YAML 之上） |
| `memory.log` | 诊断日志（自动轮转） |

## 配置

缺省即可用。要改，优先用设置页「自动化」（即时生效）；或在 profile 的 `cordis.patch.yml` 加：

```yaml
- id: dsh-memory
  name: dsh-memory
  config:
    recall:
      maxResults: 5        # 每轮注入记忆条数上限
      maxTotalRecallChars: 2000
    llm:
      provider: ''         # 留空跟随默认模型；填了则 pin 蒸馏路由
      model: ''
```

## 安装 / 卸载

```bash
# 安装（假设插件已在 ~/.dsh/plugins/dsh-memory 并已登记 profile）
# 修改代码后：把目录重新拷过去 + 重启 DSH

# 卸载：从 profile package.json 移除依赖与 bundles 行，重启；数据保留在 ~/.dsh/memory/
```

## 开发

```bash
npm test        # 36 项：存储 / 检索 / 配置 / Prompt 解析 / 管线 / 召回 / 路由 / 冒烟（node --check + 桩 ctx 全链路）
```

测试经 `test/stub-bundles.mjs` loader hooks 把 `@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-tools` 桩掉，
全模块图可在裸 Node 运行；`@deepseek-ai/*` 的真实 import 只存在于 `lib/host.js` 一处。

## 与 dsh-layered-memory 的差异

- 纯 JSONL/JSON 存储，无 SQLite / jieba FTS / 向量检索（关键词「精度×覆盖」评分 + 时效衰减足够个人库规模）；
- 无本地 embedding 模型、无成本看板图表库、无 TUI 适配；五区工作台为精简实现；
- L1 去重合并进抽取调用（相似候选池 + existing_id 合并），省一次 LLM 往返；
- 记忆档位（生活/工作分域）暂未实现，为全局单一记忆库。

## License

MIT
