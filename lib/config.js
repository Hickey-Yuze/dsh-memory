// dsh-memory — 配置：默认值 ⊕ YAML 静态配置 ⊕ 运行时 overlay（dataDir/config.json）。
// 深度按节合并；只接受已知键与正确类型的值（脏值忽略，不抛错——配置永远可用）。

export const DEFAULTS = Object.freeze({
  enabled: true,
  dataDir: '',                 // 空 = $DSH_HOME/dsh-memory（独立目录，不与 dsh-layered-memory 的 ~/.dsh/memory 混用）
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
    minNewMemories: 5,         // 距上次 L2 的新记忆阈值
    maxScenes: 12,             // 场景块数量上限
    sceneContextLimit: 3,      // L2 prompt 附带的相似场景全文上限
  },
  l3: {
    enabled: true,
    interval: 20,              // L3 蒸馏间隔（新记忆条数）
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
  llm: {
    provider: '',              // 双字段齐 = 部署 pin；留空跟随默认模型
    model: '',
    temperature: 0.3,
    maxTokens: 16384,
    timeoutMs: 120000,
    maxInputChars: 200000,     // 单次蒸馏输入字符预算
  },
  tokenCost: {
    retentionDays: 365,        // 用量明细保留天数；0 永久
  },
  tools: true,                 // 注册模型可调用的记忆工具
});

// 允许出现的键（节 → 子键白名单），未知键一律丢弃。
const KEYS = {
  enabled: 'boolean',
  dataDir: 'string',
  capture: { enabled: 'boolean', stripCodeBlocks: 'boolean', maxMessageChars: 'number' },
  extract: { enabled: 'boolean', minMessages: 'number', idleSeconds: 'number', backgroundMessages: 'number', candidatePool: 'number', maxMemoriesPerRun: 'number' },
  l2: { enabled: 'boolean', minNewMemories: 'number', maxScenes: 'number', sceneContextLimit: 'number' },
  l3: { enabled: 'boolean', interval: 'number' },
  recall: { enabled: 'boolean', maxResults: 'number', maxCharsPerMemory: 'number', maxTotalRecallChars: 'number', timeoutMs: 'number', scoreThreshold: 'number', decayHalfLifeDays: 'number', includePersona: 'boolean', includeSceneNav: 'boolean' },
  llm: { provider: 'string', model: 'string', temperature: 'number', maxTokens: 'number', timeoutMs: 'number', maxInputChars: 'number' },
  tokenCost: { retentionDays: 'number' },
  tools: 'boolean',
};

function pickTyped(source, schema) {
  const out = {};
  if (source === null || typeof source !== 'object') return out;
  for (const [key, type] of Object.entries(schema)) {
    const value = source[key];
    if (typeof value === type && !(type === 'number' && !Number.isFinite(value))) out[key] = value;
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

/** 深合并（按节覆盖），返回全新对象；顺序：base ← layers... */
export function mergeConfig(base, ...layers) {
  const out = structuredClone(base);
  for (const layer of layers) {
    const clean = sanitizeConfig(layer);
    for (const [key, value] of Object.entries(clean)) {
      if (typeof value === 'object' && value !== null && typeof out[key] === 'object' && out[key] !== null) {
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
