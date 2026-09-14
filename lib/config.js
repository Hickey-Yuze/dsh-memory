// dsh-memory — 配置：默认值 ⊕ YAML 静态配置 ⊕ 运行时 overlay（dataDir/config.json）。
// 深度按节合并；只接受已知键与正确类型的值（脏值忽略，不抛错——配置永远可用）。

export const DEFAULTS = Object.freeze({
  enabled: true,
  dataDir: '',                 // 空 = $DSH_HOME/dsh-memory（独立目录，不与 dsh-layered-memory 的 ~/.dsh/memory 混用）
  family: 'auto',              // 新会话默认记忆档位：auto（双族自动）| chat（个人）| work（工作）
  capture: {
    enabled: true,
    stripCodeBlocks: true,     // 助手消息剥离代码块再入库
    maxMessageChars: 4000,     // 单条消息入库最大字符数
  },
  extract: {
    enabled: true,
    minMessages: 6,            // 稳态触发阈值（起步 1 翻倍爬坡到此值）
    idleSeconds: 300,          // 闲置兜底：静默 N 秒后落袋蒸馏；0 关闭
    backgroundMessages: 10,    // 抽取时附带的背景消息条数
    candidatePool: 5,          // 去重候选池大小
    maxMemoriesPerRun: 8,      // 单次抽取新记忆上限
  },
  l2: {
    enabled: true,
    minNewMemories: 5,         // 距上次 L2 的新记忆阈值（分族各自计数）
    maxScenes: 12,             // 每族场景块数量上限
    sceneContextLimit: 3,      // L2 prompt 附带的相似场景全文上限
  },
  l3: {
    enabled: true,
    interval: 20,              // L3 蒸馏间隔（分族各自的新记忆条数）
  },
  recall: {
    enabled: true,
    maxResults: 5,             // 每轮注入的 L1 条数上限
    maxCharsPerMemory: 500,    // 单条注入字符上限（0 不限）
    maxTotalRecallChars: 2000, // 整轮注入总字符上限（0 不限）
    timeoutMs: 5000,           // 召回总预算；超时跳过本轮，绝不阻塞对话
    scoreThreshold: 0.3,       // 召回分数阈值
    decayHalfLifeDays: 30,     // 时效衰减半衰期（0 关闭）
    includePersona: true,      // 系统提示注入画像（稳定区）
    includeSceneNav: true,     // 系统提示注入场景导航（稳定区）
  },
  embedding: {
    enabled: false,            // 向量检索总开关；关闭即纯关键词运行
    baseUrl: '',               // OpenAI 兼容 /embeddings 服务地址（如 https://api.siliconflow.cn/v1）
    apiKey: '',
    model: '',
    dimensions: 0,             // 向量维度（启用时必填，须与模型输出一致）
    maxInputChars: 5000,       // 单条文本最大字符数（超长截断）
    timeoutMs: 10000,          // 单次 embedding 调用超时（ms）
  },
  knowledge: {
    enabled: false,            // 知识库索引总开关；关闭不扫描不检索
    paths: [],                 // 待索引目录列表（如 C:\Users\华硕\Desktop\Yuze\knowledge）
    extensions: ['.md', '.txt'], // 可索引扩展名（小写含点；跳过点开头目录与常见噪音目录）
    maxFileBytes: 2097152,     // 跳过超过此大小的文件（默认 2MB）
    maxFileChars: 60000,       // 单文件最多索引的字符数（超长截断）
    chunkChars: 1200,          // 分块目标长度（按段落聚合，字符）
    maxFiles: 500,             // 索引文件数上限
    scoreThreshold: 0.05,      // 片段召回分数阈值（文件文本与口语查询重叠度低，阈值放宽）
    maxResults: 3,             // 每轮注入的文件片段上限
    maxTotalChars: 1200,       // 文件片段注入总字符预算
  },
  llm: {
    provider: '',              // 双字段齐 = 部署 pin；留空跟随默认模型
    model: '',
    reasoningEffort: '',       // 蒸馏思考档位；空串不传（跟随模型默认）
    fallbacks: [],             // 回退链：[{provider, model, reasoningEffort?}]，主路由失败按序降级
    layerRoutes: { l1: [], l2: [], l3: [] }, // 按层完整链；非空（头行双显式）即替换该层解析
    temperature: 0.3,
    maxTokens: 16384,
    timeoutMs: 120000,
    maxInputChars: 200000,     // 单次蒸馏输入字符预算（超限的 L1 输入自动分块抽取）
  },
  tokenCost: {
    retentionDays: 365,        // 用量明细保留天数；0 永久
  },
  tools: true,                 // 注册模型可调用的记忆工具
});

// 允许出现的键（节 → 子键白名单），未知键一律丢弃。
// 类型标记：'boolean' | 'number' | 'string' | 'mode' | 'routeList' | 'layerRoutes'
const KEYS = {
  enabled: 'boolean',
  dataDir: 'string',
  family: 'mode',
  capture: { enabled: 'boolean', stripCodeBlocks: 'boolean', maxMessageChars: 'number' },
  extract: { enabled: 'boolean', minMessages: 'number', idleSeconds: 'number', backgroundMessages: 'number', candidatePool: 'number', maxMemoriesPerRun: 'number' },
  l2: { enabled: 'boolean', minNewMemories: 'number', maxScenes: 'number', sceneContextLimit: 'number' },
  l3: { enabled: 'boolean', interval: 'number' },
  recall: { enabled: 'boolean', maxResults: 'number', maxCharsPerMemory: 'number', maxTotalRecallChars: 'number', timeoutMs: 'number', scoreThreshold: 'number', decayHalfLifeDays: 'number', includePersona: 'boolean', includeSceneNav: 'boolean' },
  knowledge: { enabled: 'boolean', paths: 'pathList', extensions: 'extList', maxFileBytes: 'number', maxFileChars: 'number', chunkChars: 'number', maxFiles: 'number', scoreThreshold: 'number', maxResults: 'number', maxTotalChars: 'number' },
  embedding: { enabled: 'boolean', baseUrl: 'string', apiKey: 'string', model: 'string', dimensions: 'number', maxInputChars: 'number', timeoutMs: 'number' },
  llm: {
    provider: 'string', model: 'string', reasoningEffort: 'string',
    fallbacks: 'routeList', layerRoutes: 'layerRoutes',
    temperature: 'number', maxTokens: 'number', timeoutMs: 'number', maxInputChars: 'number',
  },
  tokenCost: { retentionDays: 'number' },
  tools: 'boolean',
};

/** 回退链条目：{provider, model, reasoningEffort?}；残缺条目剔除。 */
function sanitizeRouteList(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    if (typeof item.provider !== 'string' || typeof item.model !== 'string') continue;
    const entry = { provider: item.provider.trim(), model: item.model.trim() };
    if (!entry.provider || !entry.model) continue;
    if (item.reasoningEffort === undefined || item.reasoningEffort === null) {
      entry.reasoningEffort = '';
    } else if (typeof item.reasoningEffort === 'string') {
      entry.reasoningEffort = item.reasoningEffort.slice(0, 16);
    } else {
      continue;
    }
    out.push(entry);
  }
  return out;
}

function sanitizeLayerRoutes(value) {
  const out = {};
  if (value && typeof value === 'object') {
    for (const key of ['l1', 'l2', 'l3']) out[key] = sanitizeRouteList(value[key]);
  } else {
    for (const key of ['l1', 'l2', 'l3']) out[key] = [];
  }
  return out;
}

/** 字符串列表（目录/扩展名等）：逐项裁剪、去空、去重、限量。 */
function sanitizeStringList(value, { maxItems = 16, maxLen = 260 } = {}) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > maxLen || out.includes(trimmed)) continue;
    out.push(trimmed);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** 扩展名列表：统一小写、确保以点开头（无点自动补）。 */
function sanitizeExtList(value) {
  return sanitizeStringList(value, { maxItems: 12, maxLen: 16 })
    .map((ext) => (ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`))
    .filter((ext) => ext.length > 1);
}

function pickTyped(source, schema) {
  const out = {};
  if (source === null || typeof source !== 'object') return out;
  for (const [key, type] of Object.entries(schema)) {
    const value = source[key];
    if (type === 'routeList') {
      const list = sanitizeRouteList(value);
      if (list.length > 0) out[key] = list;
    } else if (type === 'pathList') {
      const list = sanitizeStringList(value);
      if (list.length > 0) out[key] = list;
    } else if (type === 'extList') {
      const list = sanitizeExtList(value);
      if (list.length > 0) out[key] = list;
    } else if (type === 'layerRoutes') {
      const routes = sanitizeLayerRoutes(value);
      if (routes.l1.length + routes.l2.length + routes.l3.length > 0) out[key] = routes;
    } else if (type === 'mode') {
      if (value === 'auto' || value === 'chat' || value === 'work') out[key] = value;
    } else if (typeof value === type && !(type === 'number' && !Number.isFinite(value))) {
      out[key] = value;
    }
  }
  return out;
}

/** 按白名单从任意来源提取合法配置片段（脏值忽略）。 */
export function sanitizeConfig(source) {
  const out = {};
  if (source === null || typeof source !== 'object') return out;
  for (const [key, type] of Object.entries(KEYS)) {
    if (typeof type === 'string') {
      const picked = pickTyped({ [key]: source[key] }, { [key]: type });
      if (key in picked) out[key] = picked[key];
    } else {
      const section = pickTyped(source[key], type);
      if (Object.keys(section).length > 0) out[key] = section;
    }
  }
  return out;
}

/** 回退链去重（与主路由相同的条目跳过——注定失败的重复尝试不占位）。 */
export function dedupeChain(routes) {
  const seen = new Set();
  const out = [];
  for (const r of routes) {
    const key = `${r.provider}::${r.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** 深合并（按节覆盖），返回全新对象；顺序：base ← layers... */
export function mergeConfig(base, ...layers) {
  const out = structuredClone(base);
  for (const layer of layers) {
    const clean = sanitizeConfig(layer);
    for (const [key, value] of Object.entries(clean)) {
      if (typeof value === 'object' && value !== null && typeof out[key] === 'object' && out[key] !== null
        && !Array.isArray(value) && !Array.isArray(out[key])) {
        Object.assign(out[key], value);
      } else {
        out[key] = value;
      }
    }
  }
  return out;
}

/**
 * 创建运行时配置视图：effective() 每次返回 默认值 ⊕ YAML ⊕ overlay 的合并结果。
 * overlay 由设置页经 /api-memory/config 写入 dataDir/config.json，即时生效。
 */
export function createConfig(yamlConfig, overlayStore) {
  return {
    /** 当前生效配置（每次调用现算，改动即时可见）。 */
    effective() {
      return mergeConfig(DEFAULTS, yamlConfig || {}, overlayStore ? overlayStore.read() : {});
    },
    /** 解析数据目录：config.dataDir 优先，否则 $DSH_HOME/dsh-memory。 */
    resolveDataDir(effective) {
      const cfg = effective || this.effective();
      if (cfg.dataDir && cfg.dataDir.trim()) return cfg.dataDir.trim();
      const home = process.env.DSH_HOME || `${process.env.HOME || process.env.USERPROFILE || ''}/.dsh`;
      return `${home}/dsh-memory`;
    },
  };
}
