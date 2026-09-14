// 测试专用 loader hooks：把宿主捆绑包 @deepseek-ai/dsh-llm / dsh-tools 映射为桩实现，
// 使插件模块图在裸 Node（无宿主）下可完整加载。仅测试进程使用，不随插件分发。

export async function resolve(specifier, context, next) {
  if (specifier === '@deepseek-ai/dsh-llm' || specifier === '@deepseek-ai/dsh-tools') {
    return { url: `dsh-stub:${specifier}`, shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.startsWith('dsh-stub:')) {
    const name = url.slice('dsh-stub:'.length);
    const source = name === '@deepseek-ai/dsh-llm' ? LLM_STUB : TOOLS_STUB;
    return { format: 'module', source, shortCircuit: true };
  }
  return next(url, context);
}

const LLM_STUB = `
export function createUserMessage(input) {
  return { role: 'user', id: 'stub-u-' + Math.random().toString(36).slice(2), content: input.content, source: input.source };
}
export function createSystemMessage(text, plugin) {
  return { role: 'system', id: 'stub-s-' + Math.random().toString(36).slice(2), content: [{ type: 'text', text }], source: { kind: 'plugin', plugin } };
}
export class BlockAssembler {
  constructor() { this._blocks = []; this._usage = undefined; this._finish = { kind: 'stop' }; }
  push(chunk) {
    if (!chunk || typeof chunk !== 'object') return;
    if (chunk.type === 'text-delta') this._blocks.push({ type: 'text', text: chunk.delta });
    else if (chunk.type === 'usage') this._usage = chunk.usage;
    else if (chunk.type === 'finish') this._finish = chunk.reason;
  }
  blocks() { return this._blocks; }
  get usage() { return this._usage; }
  get finish() { return this._finish; }
}
`;

const TOOLS_STUB = `
// 按宿主 dsh-tools 的值 schema DSL 校验（对齐桌面端实测行为）：
// 属性级 required 出现时必须为 true（可选 = 整个省略），数组形式（json-schema 子集）放行；
// 违规即抛——把宿主端 "unsupported JSON schema" 注册失败拦截在测试期。
function assertValueSchema(node, path) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error(path + ' must be a schema object');
  for (const [key, child] of Object.entries(node)) {
    if (key === 'required') {
      if (Array.isArray(child)) continue; // 对象节点 required: [names]
      if (child !== true) throw new Error(path + '.required must be true when present');
      continue;
    }
    if (key === 'properties') { for (const [k, v] of Object.entries(child || {})) assertValueSchema(v, path + '.properties.' + k); continue; }
    if (key === 'items') { assertValueSchema(child, path + '.items'); continue; }
  }
}
export function defineTool(spec) {
  for (const [key, child] of Object.entries(spec.parameters || {})) assertValueSchema(child, 'parameters.' + key);
  if (spec.output && spec.output.schema) assertValueSchema(spec.output.schema, 'output');
  return spec;
}
`;
