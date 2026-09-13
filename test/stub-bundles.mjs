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
export function defineTool(spec) { return spec; }
`;
