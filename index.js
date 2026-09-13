// dsh-memory — 分层蒸馏长期记忆插件（主入口）
// L0 会话捕获 → L1 原子记忆 → L2 场景整合 → L3 画像蒸馏，
// 模型每轮前自动注入相关记忆，并提供记忆检索工具。

export { apply, inject, name } from './lib/host.js';
