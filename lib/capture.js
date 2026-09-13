// dsh-memory — L0 捕获：挂 session/event，把 user/assistant 文本消息追加进
// conversations/<sid>.jsonl（事实源），并通知管线调度蒸馏。
// 监听器绝不抛错；插件注入的合成消息（source.kind === 'plugin'）不入库。

export function attachCapture(ctx, { store, pipeline, config, log }) {
  const seenSessions = new Set();

  function textOf(content, { stripCodeBlocks }) {
    if (!Array.isArray(content)) return '';
    const parts = [];
    for (const block of content) {
      if (block && block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        parts.push(block.text);
      }
    }
    let text = parts.join('\n').trim();
    if (stripCodeBlocks) text = text.replace(/```[\s\S]*?```/g, '［代码省略］').trim();
    return text;
  }

  function clip(text, maxChars) {
    const max = Math.max(200, Number(maxChars) || 4000);
    if (text.length <= max) return text;
    return `${text.slice(0, max)}…`;
  }

  return ctx.on('session/event', (session, event) => {
    try {
      const cfg = config.effective();
      if (!cfg.enabled || !cfg.capture.enabled) return;
      if (!session || typeof session.id !== 'string') return;
      const sid = session.id;

      if (!seenSessions.has(sid)) {
        seenSessions.add(sid);
        // 每个会话首次出现时落一条元数据（工作区路径），便于溯源
        let cwd = null;
        try { cwd = session.header && typeof session.header.cwd === 'string' ? session.header.cwd : null; } catch { /* 忽略 */ }
        try { store.appendConversationMeta(sid, { cwd }); } catch { /* 忽略 */ }
      }

      let role = null;
      let text = '';
      if (event.type === 'user/message') {
        const data = event.data || {};
        if (data.source && data.source.kind === 'plugin') return; // 合成消息（含我们的召回注入）不入库
        role = 'user';
        text = textOf(data.content, { stripCodeBlocks: false });
      } else if (event.type === 'assistant/message') {
        const message = (event.data || {}).message || {};
        if (message.source && message.source.kind === 'plugin') return;
        role = 'assistant';
        text = textOf(message.content, { stripCodeBlocks: cfg.capture.stripCodeBlocks });
      } else {
        return;
      }
      if (!role || !text) return;
      text = clip(text, cfg.capture.maxMessageChars);
      store.appendConversation(sid, role, text);
      pipeline.noteActivity(sid);
    } catch (e) {
      log.error(`捕获失败: ${e.message || e}`);
    }
  });
}

/** 重置注入去重的挂载（压缩后记忆可重新注入）。供 recall 模块复用同一监听器。 */
export function attachCompactionReset(ctx, { onCompaction, log }) {
  return ctx.on('session/event', (session, event) => {
    try {
      if (event.type === 'compaction/end' && session && typeof session.id === 'string') {
        onCompaction(session.id);
      }
    } catch (e) {
      log.warn(`压缩事件处理失败: ${e.message || e}`);
    }
  });
}
