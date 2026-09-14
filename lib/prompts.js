// dsh-memory — 蒸馏 Prompt 构造与输出解析（L1 抽取 / L2 场景整合 / L3 画像）。
// 分族语义对齐 dsh-layered-memory：chat=个人记忆、work=工作记忆、auto=双族自动
// （每条记忆显式输出 family，语境归族、形状不归族）。
// 模型输出一律要求严格 JSON；解析走宽松抽取（剥代码栅栏、截取最外层大括号），
// 解析失败返回 null 交给管线记账重试。

// ---------- 通用解析 ----------

/** 宽松 JSON 抽取：剥 ```栅栏，截取第一个 { 到与之配对的最后 }。 */
export function extractJsonLoose(text) {
  if (!text) return null;
  let raw = String(text).trim();
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = raw.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1));
        } catch {
          try {
            // 容忍尾逗号
            return JSON.parse(raw.slice(start, i + 1).replace(/,\s*([}\]])/g, '$1'));
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

function asStringArray(value, max = 6) {
  if (!Array.isArray(value)) return [];
  return value.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim().slice(0, 24)).slice(0, max);
}

/** 抽取输出的 family 归一：只认 chat|work，其余交由调用方兜底。 */
export function normExtractedFamily(raw) {
  return raw === 'chat' || raw === 'work' ? raw : undefined;
}

// ---------- L1 抽取 ----------

const FAMILY_RULES = [
  '归族判定（family）——先定族，再抽取：每条记忆必须显式标注 "family": "chat" 或 "work"，判定只看语境，不看内容形状：',
  '- work：内容发生在职业语境——项目、团队、系统、业务、客户、同事协作、部署/开发/运维。',
  '- chat：内容发生在个人生活语境——家庭、健康、消费、学习、爱好、个人行程，以及对 AI 的个人要求。',
  '- 形状词（方案/安排/计划/周期/规则）不决定 family：个人的喂养计划、健身安排、用药周期都是 chat；只有职业团队语境下的方案流程才是 work。',
].join('\n');

export function buildL1Prompt({ slice, backgroundCount, existingPool, maxMemories, family = 'auto' }) {
  const transcript = slice
    .map((m) => `${m.r === 'user' ? '用户' : '助手'}: ${m.text}`)
    .join('\n');
  const backgroundNote = backgroundCount > 0 && slice.length > backgroundCount
    ? `（前 ${Math.min(backgroundCount, slice.length)} 条是背景上下文，重点抽取其后的新内容）\n`
    : '';
  const pool = existingPool.length > 0
    ? `\n已有记忆候选（用于去重；若新内容与某条重复或只是小幅补充，返回 existing_id 合并更新而不是新增）：\n${existingPool.map((r) => `- [${r.id}] ${r.content}`).join('\n')}\n`
    : '';

  const base = [
    '你是用户长期记忆的抽取器。从对话记录中抽取值得长期记住的信息：',
    '- 用户的身份、偏好、习惯、项目背景、明确的决定与承诺、重要事实。',
    '- 跳过闲聊、寒暄、一次性任务细节、代码实现细节。',
    '- 每条记忆是独立的原子事实，不超过 200 字，使用对话原文语言。',
  ];
  let system;
  if (family === 'auto') {
    system = [
      ...base,
      `- 对话可能同时包含个人生活与工作内容，两类都抽取、互不排斥；最多输出 ${maxMemories} 条；没有值得记的就输出空列表。`,
      '- 已有记忆的信息只在新内容有实质补充时合并更新（内容写合并后的完整版）。',
      FAMILY_RULES,
      '只输出 JSON，格式：',
      '{"memories":[{"content":"...","tags":["标签"],"family":"chat|work","existing_id":"可选，合并更新时填写"}]}',
    ].join('\n');
  } else if (family === 'work') {
    system = [
      '你是团队工作记忆的抽取器。从工作对话中抽取值得长期记住的工作信息：',
      '- 项目事实、任务与分工、决策结论、可复用的方法/SOP/禁忌、交付物、风险与阻塞。',
      '- 只提取对后续协作有长期价值的内容；不提取与工作无关的个人偏好或私人信息。',
      '- 每条记忆是独立的原子事实，不超过 200 字，使用对话原文语言。',
      `- 最多输出 ${maxMemories} 条；没有值得记的就输出空列表。`,
      '- 已有记忆的信息只在新内容有实质补充时合并更新（内容写合并后的完整版）。',
      '只输出 JSON，格式：',
      '{"memories":[{"content":"...","tags":["标签"],"existing_id":"可选，合并更新时填写"}]}',
    ].join('\n');
  } else {
    system = [
      ...base,
      '- 只抽取用户个人生活语境的内容（家庭、健康、偏好、学习、个人安排、对 AI 的要求），跳过工作项目内容。',
      `- 最多输出 ${maxMemories} 条；没有值得记的就输出空列表。`,
      '- 已有记忆的信息只在新内容有实质补充时合并更新（内容写合并后的完整版）。',
      '只输出 JSON，格式：',
      '{"memories":[{"content":"...","tags":["标签"],"existing_id":"可选，合并更新时填写"}]}',
    ].join('\n');
  }
  const user = `${backgroundNote}对话记录：\n${transcript}${pool}`;
  return { system, user };
}

/** 解析 L1 输出 → [{content, tags, existingId, family?}]；非法条目丢弃。 */
export function parseL1Output(text, { maxMemories = 8 } = {}) {
  const obj = extractJsonLoose(text);
  if (!obj || !Array.isArray(obj.memories)) return null;
  const out = [];
  for (const item of obj.memories) {
    if (!item || typeof item !== 'object') continue;
    const content = typeof item.content === 'string' ? item.content.trim() : '';
    if (!content) continue;
    out.push({
      content: content.slice(0, 500),
      tags: asStringArray(item.tags),
      family: normExtractedFamily(item.family),
      existingId: typeof item.existing_id === 'string' && item.existing_id ? item.existing_id : null,
    });
    if (out.length >= maxMemories) break;
  }
  return out;
}

// ---------- L2 场景整合 ----------

export function buildL2Prompt({ records, existingScenes, maxScenes, sceneContextLimit, maxInputChars, family = 'chat' }) {
  const recordLines = records.map((r) => `- [${r.id}] (${r.updatedAt ? new Date(r.updatedAt).toISOString().slice(0, 10) : ''}) ${r.content}`).join('\n');
  const sceneLines = existingScenes.map((s) => `- [${s.id}] ${s.title}（${(s.recordIds || []).length} 条记忆）`).join('\n');
  const similarScenes = existingScenes
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, Math.max(1, sceneContextLimit))
    .map((s) => `## ${s.title}\n${s.content}`)
    .join('\n\n');
  const domainLine = family === 'work'
    ? '你是工作记忆整合器。把零散的工作记忆组织成若干"场景块"（围绕某个项目、系统、客户、方法论或工作目标的浓缩摘要）。'
    : '你是记忆整合器。把零散的原子记忆组织成若干"场景块"（某个人类场景的浓缩摘要，如：某个项目、某类偏好、某段关系）。';
  const system = [
    domainLine,
    `- 场景数量 1~${maxScenes} 个；每个场景是一段 markdown 摘要（150~400 字），概括该场景下的关键记忆。`,
    '- 每个场景必须列出它涵盖的记忆 id（record_ids）；未归入任何场景的 id 放在 dropped_ids。',
    '- 已有场景列表现给出；延续语义接近的已有场景（沿用其 id）而不是新建重复场景。',
    similarScenes ? `- 参考现有场景全文：\n${similarScenes}` : '',
    '只输出 JSON，格式：',
    '{"scenes":[{"id":"沿用已有id或省略","title":"...","content":"markdown","record_ids":["..."]}],"dropped_ids":["..."]}',
  ].filter(Boolean).join('\n');
  const user = [
    sceneLines ? `已有场景：\n${sceneLines}` : '（暂无已有场景）',
    `\n待整合的新记忆（全部需要归入场景或明确丢弃）：\n${recordLines}`,
  ].join('\n');
  return { system, user: clip(user, maxInputChars) };
}

/** 解析 L2 输出 → {scenes:[...], droppedIds:[]}；结构不合法返回 null。 */
export function parseL2Output(text) {
  const obj = extractJsonLoose(text);
  if (!obj || !Array.isArray(obj.scenes)) return null;
  const scenes = [];
  for (const item of obj.scenes) {
    if (!item || typeof item !== 'object') continue;
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const content = typeof item.content === 'string' ? item.content.trim() : '';
    if (!title || !content) continue;
    const ids = Array.isArray(item.record_ids) ? item.record_ids.filter((i) => typeof i === 'string') : [];
    scenes.push({
      id: typeof item.id === 'string' && item.id ? item.id : null,
      title,
      content,
      record_ids: ids,
    });
  }
  if (scenes.length === 0) return null;
  const droppedIds = Array.isArray(obj.dropped_ids) ? obj.dropped_ids.filter((i) => typeof i === 'string') : [];
  return { scenes, droppedIds };
}

// ---------- L3 画像 ----------

export function buildL3Prompt({ oldPersona, records, maxInputChars, family = 'chat' }) {
  const recordLines = records
    .slice(-120)
    .map((r) => `- ${r.content}`)
    .join('\n');
  let system;
  if (family === 'work') {
    system = [
      '你是工作准则蒸馏器。基于旧的准则和最新工作记忆，输出一份更新后的"团队工作准则"（Team Operating Doctrine）。',
      '- 覆盖：当前项目与目标、关键决策与约束、协作方式与分工、可复用方法与禁忌、风险与待办。',
      '- 只保留仍然成立的信息，吸收新变化，去掉过时内容；不要罗列记忆原文。',
      '- 输出为一段 markdown（200~500 字），语言跟随记忆原文（中文为主）。',
      '只输出 JSON：{"persona":"markdown 文本"}',
    ].join('\n');
  } else {
    system = [
      '你是用户画像蒸馏器。基于旧的画像和最新记忆，输出一份更新后的"用户核心画像"。',
      '- 覆盖：身份与角色、长期目标、偏好与习惯、工作与生活重点、沟通风格。',
      '- 只保留仍然成立的信息，吸收新变化，去掉过时内容；不要罗列记忆原文。',
      '- 输出为一段 markdown（200~500 字），语言跟随记忆原文（中文为主）。',
      '只输出 JSON：{"persona":"markdown 文本"}',
    ].join('\n');
  }
  const user = [
    oldPersona ? `当前画像：\n${oldPersona}` : '（暂无画像，这是首次生成）',
    `\n近期记忆：\n${recordLines}`,
  ].join('\n');
  return { system, user: clip(user, maxInputChars) };
}

export function parseL3Output(text) {
  const obj = extractJsonLoose(text);
  if (!obj || typeof obj.persona !== 'string') return null;
  const persona = obj.persona.trim();
  if (persona.length < 20) return null;
  return persona.slice(0, 4000);
}

function clip(text, maxChars) {
  const max = Math.max(2000, Number(maxChars) || 200000);
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…（输入超限截断）`;
}
