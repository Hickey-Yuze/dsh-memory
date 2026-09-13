// dsh-memory — client 端：设置页「记忆」五区工作台（对齐 dsh-layered-memory 布局）。
// 总览 / 记忆库 / 自动化 / 洞察 / 维护。React.createElement（禁 JSX），fetch 走宿主同源。

window.__ModuleLoader__.load({
  id: "dsh-memory",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const ReactMod = require("react");
    const React = (ReactMod && ReactMod.default) ? ReactMod.default : ReactMod;
    const { createElement: h, useState, useEffect, useCallback, useRef } = React;

    // ---------- 样式基元 ----------
    const C = {
      brand: "#6f83ff",
      green: "#16a34a",
      amber: "#d97706",
      red: "#dc2626",
      muted: "var(--dsh-text-muted, #6b7280)",
      border: "var(--dsh-border, rgba(127,127,127,0.25))",
      card: "var(--dsh-card-bg, rgba(127,127,127,0.07))",
    };
    const card = { background: C.card, border: `1px solid ${C.border}`, borderRadius: "10px", padding: "14px 16px", marginBottom: "12px" };
    const row = { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" };
    const btn = {
      padding: "5px 14px", borderRadius: "8px", border: `1px solid ${C.border}`,
      background: "transparent", color: "inherit", cursor: "pointer", fontSize: "13px",
    };
    const btnPrimary = { ...btn, background: C.brand, borderColor: C.brand, color: "#fff" };
    const btnDanger = { ...btn, borderColor: C.red, color: C.red };
    const input = {
      padding: "6px 10px", borderRadius: "8px", border: `1px solid ${C.border}`,
      background: "transparent", color: "inherit", fontSize: "13px", minWidth: "60px",
    };
    const tag = (color, text) => h("span", {
      style: { fontSize: "11px", padding: "1px 8px", borderRadius: "999px", border: `1px solid ${color}`, color, whiteSpace: "nowrap" },
    }, text);
    const LAYER_LABEL = { memory: "记忆", scene: "场景", persona: "画像" };
    const LAYER_COLOR = { memory: C.brand, scene: C.green, persona: "#a855f7" };
    const VERB_LABEL = { added: "新增", updated: "更新" };

    function relTime(ts) {
      if (!ts) return "—";
      const diff = Date.now() - ts;
      if (diff < 60000) return "刚刚";
      if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
      if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
      if (diff < 7 * 86400000) return `${Math.floor(diff / 86400000)} 天前`;
      return new Date(ts).toISOString().slice(0, 10);
    }
    function fmtTokens(n) {
      if (n == null) return "—";
      if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
      if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
      return String(n);
    }

    async function api(path, options) {
      const res = await fetch(path, options);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }
    function post(path, body) {
      return api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
    }

    // ---------- 总览 ----------
    function OverviewTab(props) {
      const { data, onJump } = props;
      if (!data) return h("div", { style: { color: C.muted } }, "加载中…");
      const { counts, stats, activity, pendingDistill, rebuild } = data;
      const healthy = !props.lastError;
      return h("div", null,
        // 健康摘要卡
        h("div", { style: card },
          h("div", { style: { ...row, justifyContent: "space-between" } },
            h("div", { style: row },
              h("span", { style: { width: "9px", height: "9px", borderRadius: "50%", background: healthy ? C.green : C.amber, display: "inline-block" } }),
              h("strong", null, healthy ? "运行正常" : "有告警"),
              tag(C.brand, "存储"), tag(counts.records + counts.scenes > 0 || counts.hasPersona ? C.green : C.muted, "检索"),
              tag(stats.lastDistillAt ? C.green : C.muted, "蒸馏队列"),
            ),
            pendingDistill > 0 ? tag(C.amber, `待蒸馏 ${pendingDistill} 条`) : null,
          ),
          h("div", { style: { marginTop: "8px", fontSize: "12px", color: C.muted } },
            `记忆 ${counts.records} · 场景 ${counts.scenes} · 画像 ${counts.hasPersona ? "已生成" : "未生成"} · 会话 ${counts.conversations}（${counts.messages} 条消息）`,
          ),
          props.lastError ? h("div", { style: { marginTop: "6px", fontSize: "12px", color: C.amber } }, `最近告警：${props.lastError.message}`) : null,
          rebuild && rebuild.phase === "running" ? h("div", { style: { marginTop: "6px", fontSize: "12px", color: C.brand } },
            `全量重建进行中：${rebuild.done}/${rebuild.total}`,
          ) : null,
        ),
        // 关键数字瓦片
        h("div", { style: { ...row, alignItems: "stretch", marginBottom: "12px" } },
          tile("记忆资产", String(counts.records)),
          tile("场景", String(counts.scenes)),
          tile("本周蒸馏输出", fmtTokens(data.outputTokens7d)),
          tile("上次蒸馏", relTime(stats.lastDistillAt)),
        ),
        // 四区跳转
        h("div", { style: { ...row, marginBottom: "12px" } },
          h("button", { style: btn, onClick: () => onJump("library") }, "浏览记忆库"),
          h("button", { style: btn, onClick: () => onJump("automation") }, "自动化设置"),
          h("button", { style: btn, onClick: () => onJump("insights") }, "洞察"),
          h("button", { style: btn, onClick: () => onJump("maintenance") }, "维护"),
        ),
        // 最近活动
        h("div", { style: card },
          h("div", { style: { fontWeight: 600, marginBottom: "8px" } }, "最近活动"),
          activity.length === 0
            ? h("div", { style: { color: C.muted, fontSize: "13px" } }, "还没有记忆活动。正常使用几轮对话后，第一批原子记忆会自动沉淀到这里。")
            : h("div", null, activity.slice(0, 12).map((a, i) => h("div", {
                key: i, style: { display: "flex", gap: "8px", alignItems: "center", padding: "5px 0", borderBottom: `1px solid ${C.border}`, fontSize: "13px" },
              },
              tag(VERB_LABEL[a.verb] === "新增" ? C.green : C.brand, VERB_LABEL[a.verb] || a.verb),
              tag(LAYER_COLOR[a.layer] || C.muted, LAYER_LABEL[a.layer] || a.layer),
              h("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, a.title),
              h("span", { style: { color: C.muted, fontSize: "12px" } }, relTime(a.ts)),
            ))),
        ),
      );
    }

    function tile(label, value) {
      return h("div", { style: { ...card, flex: "1", minWidth: "110px", marginBottom: 0, textAlign: "center" } },
        h("div", { style: { fontSize: "20px", fontWeight: 700 } }, value),
        h("div", { style: { fontSize: "12px", color: C.muted, marginTop: "2px" } }, label),
      );
    }

    // ---------- 记忆库 ----------
    function LibraryTab() {
      const [type, setType] = useState("all");
      const [q, setQ] = useState("");
      const [items, setItems] = useState(null);
      const [openId, setOpenId] = useState(null);
      const load = useCallback(async () => {
        try {
          const params = new URLSearchParams({ type, q, limit: "150" });
          const data = await api(`/api-memory/assets?${params}`);
          setItems(data.items);
        } catch (e) {
          setItems([]);
        }
      }, [type, q]);
      useEffect(() => { load(); }, [load]);
      return h("div", null,
        h("div", { style: { ...row, marginBottom: "10px" } },
          h("select", { style: input, value: type, onChange: (e) => setType(e.target.value) },
            h("option", { value: "all" }, "全部资产"),
            h("option", { value: "memory" }, "L1 记忆"),
            h("option", { value: "scene" }, "L2 场景"),
            h("option", { value: "persona" }, "L3 画像"),
          ),
          h("input", { style: { ...input, flex: 1, minWidth: "160px" }, placeholder: "搜索内容…", value: q, onChange: (e) => setQ(e.target.value) }),
          h("button", { style: btn, onClick: load }, "刷新"),
        ),
        items === null ? h("div", { style: { color: C.muted } }, "加载中…")
          : items.length === 0 ? h("div", { style: card, color: C.muted }, "没有匹配的记忆资产。")
          : h("div", null, items.map((item) => h("div", { key: item.kind + item.id, style: card },
            h("div", { style: { ...row, cursor: "pointer" }, onClick: () => setOpenId(openId === item.id ? null : item.id) },
              tag(LAYER_COLOR[item.kind] || C.muted, LAYER_LABEL[item.kind] || item.kind),
              h("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
                item.kind === "memory" ? item.content.slice(0, 90) : item.title),
              h("span", { style: { color: C.muted, fontSize: "12px" } }, relTime(item.updatedAt)),
            ),
            openId === item.id ? h("div", { style: { marginTop: "10px", paddingTop: "10px", borderTop: `1px solid ${C.border}` } },
              h("div", { style: { whiteSpace: "pre-wrap", fontSize: "13px", lineHeight: 1.6 } }, item.content),
              h("div", { style: { ...row, marginTop: "10px", fontSize: "12px", color: C.muted } },
                item.tags && item.tags.length > 0 ? h("span", null, "标签: " + item.tags.join("、")) : null,
                item.kind === "memory" && item.hits != null ? h("span", null, `召回 ${item.hits} 次`) : null,
                item.kind === "scene" ? h("span", null, `涵盖 ${item.recordCount} 条记忆`) : null,
                h("span", { style: { flex: 1 } }),
                h("button", { style: btn, onClick: () => navigator.clipboard && navigator.clipboard.writeText(item.content) }, "复制"),
                item.kind === "memory" ? h("button", {
                  style: btnDanger,
                  onClick: async () => { await post("/api-memory/records/delete", { id: item.id }); load(); },
                }, "删除") : null,
              ),
            ) : null,
          ))),
      );
    }

    // ---------- 自动化 ----------
    const TOGGLES = [
      ["", "enabled", "总开关", "关闭后捕获、蒸馏、注入全部暂停"],
      ["capture", "capture.enabled", "L0 捕获", "把对话写入本地事实源"],
      ["extract", "extract.enabled", "L1 抽取", "从对话中蒸馏原子记忆"],
      ["l2", "l2.enabled", "L2 场景整合", "攒够阈值后把记忆组织成场景块"],
      ["l3", "l3.enabled", "L3 画像蒸馏", "定期更新用户核心画像"],
      ["recall", "recall.enabled", "召回注入", "新消息前自动注入相关记忆"],
      ["", "tools", "记忆工具", "向模型开放 memory_search 等工具"],
    ];
    const NUMBERS = [
      ["extract.minMessages", "抽取阈值（条消息）"],
      ["extract.idleSeconds", "闲置兜底（秒）"],
      ["recall.maxResults", "召回条数上限"],
      ["recall.scoreThreshold", "召回分数阈值"],
      ["recall.maxTotalRecallChars", "注入总字符上限"],
      ["recall.timeoutMs", "召回超时（ms）"],
      ["recall.decayHalfLifeDays", "时效半衰期（天，0 关）"],
      ["llm.timeoutMs", "蒸馏超时（ms）"],
    ];

    function AutomationTab() {
      const [cfg, setCfg] = useState(null);
      const [saved, setSaved] = useState("");
      useEffect(() => { api("/api-memory/config").then((d) => setCfg(d.effective)).catch(() => setCfg({})); }, []);
      const getIn = (path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), cfg);
      const setIn = (path, value) => {
        setCfg((prev) => {
          const next = structuredClone(prev);
          const keys = path.split(".");
          let cur = next;
          for (let i = 0; i < keys.length - 1; i++) {
            if (typeof cur[keys[i]] !== "object" || cur[keys[i]] === null) cur[keys[i]] = {};
            cur = cur[keys[i]];
          }
          cur[keys[keys.length - 1]] = value;
          return next;
        });
      };
      const save = async () => {
        try {
          await post("/api-memory/config", cfg);
          setSaved("已保存，即时生效");
          setTimeout(() => setSaved(""), 2500);
        } catch (e) {
          setSaved("保存失败: " + e.message);
        }
      };
      if (!cfg) return h("div", { style: { color: C.muted } }, "加载中…");
      return h("div", null,
        h("div", { style: card },
          h("div", { style: { fontWeight: 600, marginBottom: "8px" } }, "开关"),
          TOGGLES.map(([_, path, label, desc]) => h("label", { key: path, style: { ...row, padding: "4px 0", cursor: "pointer", fontSize: "13px" } },
            h("input", { type: "checkbox", checked: Boolean(getIn(path)), onChange: (e) => setIn(path, e.target.checked) }),
            h("span", { style: { width: "110px" } }, label),
            h("span", { style: { color: C.muted } }, desc),
          )),
        ),
        h("div", { style: card },
          h("div", { style: { fontWeight: 600, marginBottom: "8px" } }, "蒸馏与召回参数"),
          h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "8px" } },
            NUMBERS.map(([path, label]) => h("label", { key: path, style: { ...row, fontSize: "13px" } },
              h("span", { style: { flex: 1 } }, label),
              h("input", { style: { ...input, width: "90px" }, type: "number", value: getIn(path) ?? "", onChange: (e) => setIn(path, Number(e.target.value)) }),
            )),
          ),
        ),
        h("div", { style: row },
          h("button", { style: btnPrimary, onClick: save }, "保存配置"),
          saved ? h("span", { style: { fontSize: "13px", color: saved.startsWith("已") ? C.green : C.red } }, saved) : null,
        ),
      );
    }

    // ---------- 洞察 ----------
    function InsightsTab() {
      const [data, setData] = useState(null);
      useEffect(() => {
        api("/api-memory/insights").then(setData).catch(() => setData({}));
      }, []);
      if (!data) return h("div", { style: { color: C.muted } }, "加载中…");
      const maxDay = Math.max(1, ...(data.byDay || []).map((d) => d.outputTokens));
      return h("div", null,
        h("div", { style: card },
          h("div", { style: { fontWeight: 600, marginBottom: "8px" } }, "近 7 天资产活动"),
          h("div", { style: { ...row } },
            h("span", { style: { fontSize: "13px", color: C.muted } }, "新增记忆："),
            h("strong", null, (data.byDay || []).reduce((s, d) => s + (d.added || 0), 0)),
            h("span", { style: { fontSize: "13px", color: C.muted, marginLeft: "16px" } }, "蒸馏调用："),
            h("strong", null, (data.byDay || []).reduce((s, d) => s + (d.calls || 0), 0)),
          ),
          h("div", { style: { display: "flex", alignItems: "flex-end", gap: "4px", height: "80px", marginTop: "10px" } },
            (data.byDay || []).map((d) => h("div", { key: d.day, style: { flex: 1, textAlign: "center" } },
              h("div", { style: { height: `${Math.max(2, (d.outputTokens / maxDay) * 64)}px`, background: C.brand, borderRadius: "3px 3px 0 0", opacity: 0.85 } }),
              h("div", { style: { fontSize: "10px", color: C.muted, marginTop: "2px" } }, d.day.slice(5)),
            )),
          ),
        ),
        h("div", { style: card },
          h("div", { style: { fontWeight: 600, marginBottom: "8px" } }, "召回"),
          h("div", { style: row, },
            h("span", { style: { fontSize: "13px", color: C.muted } }, "累计注入轮次"),
            h("strong", null, String((data.recall && data.recall.recallInjections) || 0)),
            h("span", { style: { fontSize: "13px", color: C.muted, marginLeft: "16px" } }, "累计注入记忆"),
            h("strong", null, String((data.recall && data.recall.recallRecords) || 0)),
            h("span", { style: { fontSize: "13px", color: C.muted, marginLeft: "16px" } }, "最后注入"),
            h("span", null, relTime(data.recall && data.recall.lastRecallAt)),
          ),
        ),
        h("div", { style: card },
          h("div", { style: { fontWeight: 600, marginBottom: "8px" } }, "蒸馏成本（近 7 天 · 按模型）"),
          (data.byModel || []).length === 0
            ? h("div", { style: { color: C.muted, fontSize: "13px" } }, "还没有蒸馏调用记录。")
            : h("table", { style: { width: "100%", fontSize: "13px", borderCollapse: "collapse" } },
              h("thead", null, h("tr", null, ["模型", "调用", "失败", "输出 token", "思考 token", "输入字符"].map((th) =>
                h("th", { key: th, style: { textAlign: "left", padding: "4px 8px", borderBottom: `1px solid ${C.border}`, color: C.muted, fontWeight: 500 } }, th)))),
              h("tbody", null, data.byModel.map((m) => h("tr", { key: m.model },
                h("td", { style: { padding: "4px 8px" } }, m.model),
                h("td", { style: { padding: "4px 8px" } }, m.calls),
                h("td", { style: { padding: "4px 8px", color: m.failures > 0 ? C.red : "inherit" } }, m.failures),
                h("td", { style: { padding: "4px 8px" } }, fmtTokens(m.outputTokens)),
                h("td", { style: { padding: "4px 8px" } }, fmtTokens(m.reasoningTokens)),
                h("td", { style: { padding: "4px 8px" } }, fmtTokens(m.inChars)),
              ))),
            ),
          (data.failures || []).length > 0 ? h("div", { style: { marginTop: "10px", fontSize: "12px", color: C.red } },
            "近期失败：" + data.failures.slice(0, 3).map((f) => `[${f.layer}] ${f.error || "unknown"}`).join("；"),
          ) : null,
        ),
      );
    }

    // ---------- 维护 ----------
    function MaintenanceTab(props) {
      const [logs, setLogs] = useState([]);
      const [status, setStatus] = useState(null);
      const [confirming, setConfirming] = useState("");
      const [msg, setMsg] = useState("");
      const loadLogs = useCallback(async () => {
        try {
          const d = await api("/api-memory/logs?limit=200");
          setLogs(d.lines);
          props.onLastError(d.errors && d.errors.length > 0 ? d.errors[d.errors.length - 1] : null);
        } catch { /* 忽略 */ }
      }, [props.onLastError]);
      const loadStatus = useCallback(async () => {
        try { setStatus(await api("/api-memory/rebuild")); } catch { /* 忽略 */ }
      }, []);
      useEffect(() => {
        loadLogs();
        loadStatus();
        const timer = setInterval(loadStatus, 3000);
        return () => clearInterval(timer);
      }, [loadLogs, loadStatus]);
      const rb = status && status.rebuild;
      const startRebuild = async () => {
        setConfirming("");
        try {
          const d = await post("/api-memory/rebuild", {});
          setMsg(d.ok ? `重建已开始（共 ${d.total} 条消息）` : `未开始：${d.reason || d.error || "未知原因"}`);
        } catch (e) { setMsg("失败: " + e.message); }
        loadStatus();
      };
      return h("div", null,
        h("div", { style: card },
          h("div", { style: { fontWeight: 600, marginBottom: "8px" } }, "全量重建"),
          h("div", { style: { fontSize: "13px", color: C.muted, marginBottom: "8px" } },
            "丢弃现有 L1–L3 资产，从 L0 会话事实源重新蒸馏。L0 原始对话不受影响。"),
          rb && rb.phase === "running" ? h("div", null,
            h("div", { style: { height: "8px", background: C.card, borderRadius: "4px", overflow: "hidden", marginBottom: "6px" } },
              h("div", { style: { height: "100%", width: `${rb.total > 0 ? Math.round((rb.done / rb.total) * 100) : 0}%`, background: C.brand } }),
            ),
            h("div", { style: row },
              h("span", { style: { fontSize: "13px" } }, `${rb.done}/${rb.total}`),
              h("button", { style: btn, onClick: async () => { await post("/api-memory/rebuild", { action: "cancel" }); loadStatus(); } }, "取消"),
            ),
          ) : h("div", { style: row },
            confirming !== "rebuild"
              ? h("button", { style: btnDanger, onClick: () => setConfirming("rebuild") }, "全量重建…")
              : h("div", { style: row },
                h("span", { style: { fontSize: "13px", color: C.red } }, "确认重建？现有记忆资产将被清除后重新生成。"),
                h("button", { style: btnDanger, onClick: startRebuild }, "确认"),
                h("button", { style: btn, onClick: () => setConfirming("") }, "取消"),
              ),
            rb && rb.phase !== "running" && rb.phase ? h("span", { style: { fontSize: "12px", color: C.muted } },
              `上次重建：${rb.phase}（${relTime(rb.endedAt)}）`) : null,
          ),
          msg ? h("div", { style: { marginTop: "6px", fontSize: "13px" } }, msg) : null,
        ),
        h("div", { style: card },
          h("div", { style: { ...row, justifyContent: "space-between", marginBottom: "8px" } },
            h("div", { style: { fontWeight: 600 } }, "诊断日志（info 级以上）"),
            h("button", { style: btn, onClick: loadLogs }, "刷新"),
          ),
          h("div", { style: { maxHeight: "260px", overflow: "auto", fontSize: "11.5px", fontFamily: "ui-monospace, monospace", color: C.muted, whiteSpace: "pre-wrap", wordBreak: "break-all" } },
            logs.length === 0 ? "（暂无日志）" : logs.join("\n"),
          ),
        ),
        h("div", { style: { ...card, borderColor: C.red } },
          h("div", { style: { fontWeight: 600, marginBottom: "8px", color: C.red } }, "危险区"),
          confirming !== "wipe"
            ? h("button", { style: btnDanger, onClick: () => setConfirming("wipe") }, "清空记忆库…")
            : h("div", { style: row },
              h("span", { style: { fontSize: "13px", color: C.red } }, "将删除全部记忆资产（L0 会话保留）。再点一次连同 L0 一起删除。"),
              h("button", { style: btnDanger, onClick: async () => { await post("/api-memory/wipe", { scope: "assets" }); setConfirming(""); setMsg("记忆资产已清空"); } }, "清空资产"),
              h("button", { style: btnDanger, onClick: async () => { await post("/api-memory/wipe", { scope: "all" }); setConfirming(""); setMsg("记忆库已完全清空"); } }, "连 L0 一起删除"),
              h("button", { style: btn, onClick: () => setConfirming("") }, "取消"),
            ),
        ),
      );
    }

    // ---------- 主组件 ----------
    function MemoryWorkbench() {
      const [tab, setTab] = useState("overview");
      const [overview, setOverview] = useState(null);
      const [lastError, setLastError] = useState(null);
      const loadOverview = useCallback(async () => {
        try {
          const d = await api("/api-memory/overview");
          setOverview(d);
        } catch { /* 忽略 */ }
        try {
          const d = await api("/api-memory/health");
          setLastError(d.lastError || null);
        } catch { /* 忽略 */ }
      }, []);
      useEffect(() => {
        loadOverview();
        const timer = setInterval(loadOverview, 5000);
        return () => clearInterval(timer);
      }, [loadOverview]);
      const TABS = [
        ["overview", "总览"], ["library", "记忆库"], ["automation", "自动化"], ["insights", "洞察"], ["maintenance", "维护"],
      ];
      return h("div", { style: { minHeight: "300px" } },
        h("div", { style: { display: "flex", gap: "4px", borderBottom: `1px solid ${C.border}`, marginBottom: "14px", position: "sticky", top: 0, background: "var(--dsh-bg, inherit)", zIndex: 2 } },
          TABS.map(([id, label]) => h("button", {
            key: id,
            onClick: () => setTab(id),
            style: {
              padding: "8px 16px", border: "none", borderBottom: tab === id ? `2px solid ${C.brand}` : "2px solid transparent",
              background: "transparent", color: tab === id ? C.brand : "inherit", cursor: "pointer", fontSize: "13.5px", fontWeight: tab === id ? 600 : 400,
            },
          }, label)),
        ),
        tab === "overview" ? h(OverviewTab, { data: overview, lastError, onJump: setTab }) : null,
        tab === "library" ? h(LibraryTab, null) : null,
        tab === "automation" ? h(AutomationTab, null) : null,
        tab === "insights" ? h(InsightsTab, null) : null,
        tab === "maintenance" ? h(MaintenanceTab, { onLastError: setLastError }) : null,
      );
    }

    // ---------- 挂载 ----------
    const inject = ["slots"];

    function apply(ctx) {
      try {
        ctx.slots.inject("settings.section", () => ctx.slots.register({
          name: "settings.section",
          id: "dsh-memory",
          order: 26,
          label: () => "记忆",
          inject: () => ({}),
        }, MemoryWorkbench));
      } catch (err) {
        console.error("[dsh-memory] client apply failed:", err);
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
