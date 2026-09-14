# dsh-memory

**DeepSeek Harness 的分层蒸馏长期记忆插件（精简自研版，架构对齐 [dsh-layered-memory](https://github.com/JunNanLYS/dsh-layered-memory)）。**

对话在后台自动完成 **L0 捕获 → L1 原子记忆 → L2 场景整合 → L3 画像蒸馏**，模型每轮回答前自动注入相关记忆；提供记忆检索工具与五区记忆工作台。零原生依赖、零外部服务，蒸馏复用宿主自己的 LLM。

## 工作原理

```
会话事件 (session/event)
   │  user/message / assistant/message（跳过插件合成消息；off 档会话完全隐身）
   ▼
L0 conversations/<sid>.jsonl  ← 事实源，只增不改
   │  阈值爬坡（1→2→4…上限 minMessages）或闲置兜底触发；档位切换立即落袋
   ▼
L1 records.json     原子记忆抽取 + 同族相似候选去重合并       （ctx.llm）
   │  按族水位：新记忆 ≥ minNewMemories（chat / work 各自计数）
   ▼
L2 scenes.json      场景块整合（markdown 浓缩 + 记忆归类，分族隔离）（ctx.llm）
   │  按族水位：新记忆 ≥ interval
   ▼
L3 persona.json     画像分族滚动更新（chat=个人画像 / work=工作准则）（ctx.llm）

召回：agent/pre-step 第一步（新用户消息之后）检索 L1（按会话档位过滤族），
      关键词「精度×覆盖」评分，嵌入源就绪时 hybrid RRF 融合，时效衰减挑 Top-N，
      预算内合成 <recalled-memory> 消息注入；同会话去重持久化，/compact 后自动重置。
稳定区：画像 <user-persona> 与场景导航 <scene-navigation> 按 agent 作用域注册
      （auto 档两族按 <domain> 分块；agents 服务缺席退化为全局合并区）。
```

## 记忆档位（生活/工作分域）

对齐原版 0.4.0 语义，档位同时决定**蒸馏归族**与**召回范围**：

| 档位 | 捕获/蒸馏 | 召回范围 |
|---|---|---|
| `auto`（智能，默认） | 双族混合对话，L1 逐条显式归族（语境归族、形状不归族，兜底 chat） | 跨族检索 |
| `chat`（日常） | 切片强制族标签 `chat`，窄 prompt 只抽个人语境 | 仅 chat 族 |
| `work`（工作） | 切片强制族标签 `work`，窄 prompt 抽项目/决策/方法/交付物 | 仅 work 族 |
| `off`（暂停） | 完全隐身：不写 L0、不调度蒸馏、不注入、稳定区留空、读工具拒答 | — |

- **数据流覆盖**（正交于档位）：会话级 `recall=false` = 只写不读——捕获与蒸馏照常，读侧三闸门（召回注入 / 稳定区 / 读工具）全部静默；`true` 强制开；缺省跟随全局。
- **暂停恢复快照**：进 off 档记录暂停前的范围与注入覆盖，切回即恢复。
- 会话档位持久化在 `session-modes.json`（90 天过期 / 上限 500 条），可在设置页「自动化 → 会话记忆档位」逐会话调整。
- 去重永不跨族：L1 去重候选只取同族记录；跨族 `existing_id` 合并会被防御性忽略。

## 检索策略

- **keyword**（默认）：CJK 二元组 + 拉丁词元，综合分 = √(精度 × 覆盖) × 时效衰减（半衰期地板 0.5）。
- **hybrid**（配置远程嵌入源后自动启用）：关键词路 + 向量路各自产出后 **RRF（k=60）融合**，融合后乘法时效加权。任何嵌入失败（网络/维度不符/超时）单次降级关键词并告警；连续失败熔断 60s，绝不阻塞召回与工具。

## 组件

- **三个记忆工具**（`ctx.tools`）：`memory_search`（L1 检索，按会话档位过滤族）、`conversation_search`（L0 跨会话检索）、`memory_read_scene`（L2 场景全文）
- **设置页「记忆」工作台**（五区，对齐原版布局）：总览 / 记忆库 / 自动化 / 洞察 / 维护
  - 自动化：开关、默认档位、**会话档位管理**、**蒸馏路由链编辑**（回退链 + L1/L2/L3 独立链）、**嵌入源面板**（远程 OpenAI 兼容 /embeddings）
  - 洞察：窗口（1~365 天）/ 粒度（天/周/月）/ 层级筛选，**分模型趋势图**，均值/中位数统计表
  - 记忆库：分域徽章与筛选（个人/工作）
- **HTTP 数据面**：`/api-memory/health|overview|assets|config|sessions|insights|logs|rebuild|embedding|records/delete|wipe|scenes`
- **全量重建**：丢弃 L1–L3 从 L0 重导（统一 auto 档归族，进度可视、可取消）；`/compact` 压缩后召回去重自动重置
- **蒸馏可靠性**：主路由失败（报错/掐断/空输出）按 `llm.fallbacks` 顺序降级，每条路由各享全额超时，逐次尝试记账；`llm.layerRoutes` 可给 L1/L2/L3 配独立链；L1 输入超限自动分块抽取

## 存储（`~/.dsh/dsh-memory/`，与原版 dsh-layered-memory 的 `~/.dsh/memory` 互相独立）

> 注：本插件装在 desktop profile；web profile 若装有原版 dsh-layered-memory，两者数据目录互不干扰。

| 文件 | 内容 |
|---|---|
| `conversations/<sid>.jsonl` | L0 会话事实源（含 cwd 元数据行；不分族） |
| `records.json` | L1 原子记忆（`family: chat/work` 族标签） |
| `scenes.json` | L2 场景块（分族隔离） |
| `persona.json` | L3 画像（v2 分族：`families.chat` / `families.work`；v1 单文档自动迁移到 chat） |
| `state.json` | 蒸馏水位（**分族计数**）、统计、重建进度 |
| `session-modes.json` | 会话记忆档位（档位 + 注入覆盖 + 暂停快照） |
| `recall-dedupe.json` | 召回去重持久化（LRU 200 会话 / 512 id / 90 天） |
| `vectors.json` | 向量缓存（嵌入源 meta + 逐记录向量，差量重嵌） |
| `activity.jsonl` / `usage.jsonl` | 资产活动流 / 蒸馏逐次记账（成本、失败、思考 token） |
| `config.json` | 设置页写入的运行时覆盖（节级合并到 YAML 之上） |
| `memory.log` | 诊断日志（自动轮转） |

## 配置

缺省即可用。要改，优先用设置页「自动化」（即时生效）；或在 profile 的 `cordis.patch.yml` 加：

```yaml
- id: dsh-memory
  name: dsh-memory
  config:
    family: auto          # 新会话默认档位：auto | chat | work
    recall:
      maxResults: 5
      maxTotalRecallChars: 2000
    llm:
      provider: ''        # 留空跟随默认模型；填了则 pin 蒸馏主路由
      model: ''
      reasoningEffort: '' # 蒸馏思考档位；空串跟随模型默认
      fallbacks:          # 回退链：主路由失败按序降级（条目与主路由相同自动跳过）
        - provider: p2
          model: m2
      layerRoutes:        # 按层独立链（非空且头行 provider/model 齐 → 替换该层解析）
        l2:
          - provider: p2
            model: m2
    embedding:            # 远程嵌入源（默认关闭；开启后检索升级 hybrid RRF）
      enabled: false
      baseUrl: ''         # OpenAI 兼容，如 https://api.siliconflow.cn/v1
      apiKey: ''
      model: ''
      dimensions: 0       # 须与模型输出一致
```

## 安装 / 卸载

```bash
# 安装（假设插件已在 ~/.dsh/plugins/dsh-memory 并已登记 profile）
# 修改代码后：把目录重新拷过去 + 重启 DSH

# 卸载：从 profile package.json 移除依赖与 bundles 行，重启；数据保留在 ~/.dsh/dsh-memory/
```

## 开发

```bash
npm test        # 50 项：存储（分族）/ 检索（hybrid）/ 配置（路由链洗白）/ Prompt / 管线（分族蒸馏）/
                #       召回（档位门控）/ 会话档位 / 回退链 / 嵌入源 / 路由 / 冒烟（node --check + 桩 ctx 全链路）
```

测试经 `test/stub-bundles.mjs` loader hooks 把 `@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-tools` 桩掉，
全模块图可在裸 Node 运行；`@deepseek-ai/*` 的真实 import 只存在于 `lib/host.js` 一处。

## 与 dsh-layered-memory 的差异

**本轮补全后仍保留的差异化设计**（精简版定位，零原生依赖）：

- 纯 JSONL/JSON 存储，无 SQLite / jieba FTS（关键词「精度×覆盖」评分 + 时效衰减足够个人库规模；检索接口保持单一 `search.js` 缝，后续可平替）；
- 向量检索仅支持远程 OpenAI 兼容嵌入源；**本地 ONNX 嵌入运行时**（按需安装 transformers.js + sha256 锁定的模型目录 + worker 线程推理）未实现——重依赖子系统，个人库规模下远程源或纯关键词已足够；
- 无 TUI 形态适配（`/memory` 命令、状态行）——本插件面向 desktop/web profile，TUI 宿主请用原版；
- L1 去重合并进抽取调用（相似候选池 + existing_id 合并），省一次 LLM 往返（原版为独立去重调用）；
- 五区工作台为自绘轻量实现（无图表库，SVG 折线/柱图）；
- 无 `scene_name` 情境切分与 `type/priority` 类型体系（Prompt 为精简版原子记忆抽取），L2 场景整合承担原版情境链的汇总职责。

**已对齐原版的能力**：

- 记忆档位（auto/chat/work/off）+ 会话数据流（只写/读写/暂停）+ 暂停恢复快照，写入与召回同档；
- L1/L2/L3 分族隔离（族三级兜底链、去重永不跨族、分族水位、分族画像/场景）；
- 召回去重持久化（LRU/过期/压缩重置）、召回读侧三闸门（总开关 → off 档 → 会话覆盖）；
- 蒸馏回退链（空输出判失败、逐次尝试记账）+ 按层路由链；
- 成本看板（窗口/粒度/层级筛选、分模型趋势、均值/中位数、失败明细）；
- 远程嵌入源 + hybrid RRF 检索（换源失效、差量重嵌、失败降级、熔断）；
- agent 作用域稳定区（agents 服务缺席退化全局合并区）、档位切换切片落袋、L1 输入超限分块抽取。

## License

MIT
