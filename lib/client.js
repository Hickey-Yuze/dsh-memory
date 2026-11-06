// dsh-memory — client 端：设置页「记忆」五区工作台（对齐 dsh-layered-memory 布局）+ 输入栏记忆档位芯片。
// 总览 / 记忆库 / 自动化 / 洞察 / 维护。React.createElement（禁 JSX），fetch 走宿主同源。
// 补全：分族徽章与筛选、会话档位管理（档位 + 数据流）、嵌入源面板（远程）、
// 蒸馏路由链编辑（回退链 + 按层链）、成本看板增强（窗口/粒度/分层/分模型趋势/统计量）。

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
      purple: "#a855f7",
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
      boxSizing: "border-box",
    };
    const tag = (color, text) => h("span", {
      style: { fontSize: "11px", padding: "1px 8px", borderRadius: "999px", border: `1px solid ${color}`, color, whiteSpace: "nowrap" },
    }, text);
    const LAYER_LABEL = { memory: "记忆", scene: "场景", persona: "画像" };
    const LAYER_COLOR = { memory: C.brand, scene: C.green, persona: C.purple };
    const VERB_LABEL = { added: "新增", updated: "更新", merged: "合并", deleted: "删除" };
    const FAMILY_LABEL = { chat: "个人", work: "工作" };
    const FAMILY_COLOR = { chat: C.brand, work: C.amber };
    // 记忆类型（L1 记录的 kind）：fact 不显示徽标，只有非事实才标注，避免每条都挂标签
    const KIND_LABEL = { opinion: "我的判断", commitment: "待收束" };
    const KIND_COLOR = { opinion: C.purple, commitment: C.red };
    const KIND_TITLE = { opinion: "助手的主观判断或推测，未获用户确认，不可当事实使用", commitment: "尚未收束的事：待办、待排查、待拍板或进行中" };
    const MODE_LABEL = { auto: "智能", chat: "日常", work: "工作", off: "暂停" };

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
      // 写操作要带 x-dsh-memory 头（宿主端守卫：跨站请求发不出自定义头）
      const opts = { ...(options || {}) };
      const method = String(opts.method || "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD") {
        opts.headers = { ...(opts.headers || {}), "x-dsh-memory": "1" };
      }
      const res = await fetch(path, opts);
      let data = null;
      try { data = await res.json(); } catch { /* 非 JSON 响应 */ }
      if (!res.ok) {
        // 把服务端给的原因透出去，别只显示 HTTP 400
        const err = new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
        err.status = res.status;
        if (data && data.empty) err.empty = true;
        throw err;
      }
      return data;
    }
    function post(path, body) {
      return api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
    }

    // ---------- 总览 ----------
    function OverviewTab(props) {
      const { data, onJump } = props;
      if (!data) return h("div", { style: { color: C.muted } }, "加载中…");
      const { counts, stats, activity, pendingDistill, rebuild, families, sessionModes } = data;
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
            `记忆 ${counts.records}（个人 ${(families && families.chat && families.chat.records) || 0} · 工作 ${(families && families.work && families.work.records) || 0}） · 场景 ${counts.scenes} · 画像 ${counts.hasPersona ? "已生成" : "未生成"} · 会话 ${counts.conversations}（${counts.messages} 条消息）`,
          ),
          sessionModes && (sessionModes.off > 0 || sessionModes.wo > 0) ? h("div", { style: { marginTop: "6px", fontSize: "12px", color: C.muted } },
            `会话停用分布：暂停 ${sessionModes.off} · 只写 ${sessionModes.wo}`,
          ) : null,
          props.lastError ? h("div", { style: { marginTop: "6px", fontSize: "12px", color: C.amber } }, `最近告警：${props.lastError.message}`) : null,
          rebuild && rebuild.phase === "running" ? h("div", { style: { marginTop: "6px", fontSize: "12px", color: C.brand } },
            `全量重建进行中：${rebuild.done}/${rebuild.total}`,
          ) : null,
        ),
        // 关键数字瓦片
        h("div", { style: { ...row, alignItems: "stretch", marginBottom: "12px" } },
          tile("记忆资产", String(counts.records)),
          tile("场景", String(counts.scenes)),
          tile("偏差档案", String(counts.biases || 0)),
          tile("本周蒸馏输出", fmtTokens(data.outputTokens7d)),
          tile("上次蒸馏", relTime(stats.lastDistillAt)),
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
              a.family ? tag(FAMILY_COLOR[a.family] || C.muted, FAMILY_LABEL[a.family] || a.family) : null,
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
      const [family, setFamily] = useState("all");
      const [q, setQ] = useState("");
      const [items, setItems] = useState(null);
      const [openId, setOpenId] = useState(null);
      const load = useCallback(async () => {
        try {
          const params = new URLSearchParams({ type, family, q, limit: "150" });
          const data = await api(`/api-memory/assets?${params}`);
          setItems(data.items);
        } catch (e) {
          setItems([]);
        }
      }, [type, family, q]);
      useEffect(() => { load(); }, [load]);
      return h("div", null,
        h("div", { style: { ...row, marginBottom: "10px" } },
          h("select", { style: input, value: type, onChange: (e) => setType(e.target.value) },
            h("option", { value: "all" }, "全部资产"),
            h("option", { value: "memory" }, "L1 记忆"),
            h("option", { value: "scene" }, "L2 场景"),
            h("option", { value: "persona" }, "L3 画像"),
          ),
          h("select", { style: input, value: family, onChange: (e) => setFamily(e.target.value) },
            h("option", { value: "all" }, "全部分域"),
            h("option", { value: "chat" }, "个人（chat）"),
            h("option", { value: "work" }, "工作（work）"),
          ),
          h("input", { style: { ...input, flex: 1, minWidth: "160px" }, placeholder: "搜索内容…", value: q, onChange: (e) => setQ(e.target.value) }),
          h("button", { style: btn, onClick: load }, "刷新"),
        ),
        items === null ? h("div", { style: { color: C.muted } }, "加载中…")
          : items.length === 0 ? h("div", { style: card, color: C.muted }, "没有匹配的记忆资产。")
          : h("div", null, items.map((item) => h("div", { key: item.kind + item.id, style: card },
            h("div", { style: { ...row, cursor: "pointer" }, onClick: () => setOpenId(openId === item.id ? null : item.id) },
              tag(LAYER_COLOR[item.kind] || C.muted, LAYER_LABEL[item.kind] || item.kind),
              item.family ? tag(FAMILY_COLOR[item.family] || C.muted, FAMILY_LABEL[item.family] || item.family) : null,
              item.kind === "memory" && item.memKind && item.memKind !== "fact"
                ? h("span", { title: KIND_TITLE[item.memKind] || "" }, tag(KIND_COLOR[item.memKind] || C.muted, KIND_LABEL[item.memKind] || item.memKind))
                : null,
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

    // ---------- 偏差档案 ----------
    const BIAS_KIND_LABEL = { judgment: "判断错", "recall-miss": "该召没召", "recall-noise": "召来噪音", route: "路由错" };
    const BIAS_KIND_COLOR = { judgment: C.red, "recall-miss": C.amber, "recall-noise": C.amber, route: C.purple };
    const EMPTY_BIAS = { scene: "", deviation: "", rootCause: "", fix: "", family: "chat", kind: "judgment" };
    function BiasTab() {
      const [family, setFamily] = useState("all");
      const [data, setData] = useState(null);
      const [form, setForm] = useState(null);
      const [msg, setMsg] = useState("");
      const load = useCallback(async () => {
        try {
          setData(await api(`/api-memory/biases?${new URLSearchParams({ family })}`));
        } catch (e) {
          setData({ total: 0, biases: [] });
        }
      }, [family]);
      useEffect(() => { load(); }, [load]);
      const save = useCallback(async () => {
        try {
          const r = await post("/api-memory/biases", form);
          setMsg(r && r.created === false ? "已更新" : "已入档");
          setForm(null);
          load();
        } catch (e) {
          setMsg("保存失败：" + (e.message || e));
        }
      }, [form, load]);
      const field = (key, label, placeholder) => h("div", { style: { marginBottom: "8px" } },
        h("div", { style: { fontSize: "12px", color: C.muted, marginBottom: "3px" } }, label),
        h("input", { style: { ...input, width: "100%" }, placeholder, value: form[key] || "", onChange: (e) => setForm({ ...form, [key]: e.target.value }) }),
      );
      return h("div", null,
        h("div", { style: { ...row, marginBottom: "10px" } },
          h("select", { style: input, value: family, onChange: (e) => setFamily(e.target.value) },
            h("option", { value: "all" }, "全部分域"),
            h("option", { value: "chat" }, "个人（chat）"),
            h("option", { value: "work" }, "工作（work）"),
          ),
          h("span", { style: { fontSize: "12px", color: C.muted } }, "召回时只有话题撞上才注入对应偏差（阈值 0.45，最多 1 条）；与 L1 记忆共用同一套去重"),
          h("span", { style: { flex: 1 } }),
          h("button", { style: btn, onClick: () => setForm(form ? null : { ...EMPTY_BIAS }) }, form ? "取消" : "手动入档"),
        ),
        msg ? h("div", { style: { fontSize: "12px", color: C.muted, marginBottom: "8px" } }, msg) : null,
        form ? h("div", { style: card },
          field("scene", "场景（什么情境）", "例如：dsh-memory 存量改盘"),
          field("deviation", "偏差（错在哪）", "例如：以为重启够快就不会被覆盖"),
          field("rootCause", "根因（为什么错）", "例如：写盘用的是插件内存里的旧值"),
          field("fix", "修正（下次怎么做）", "例如：先在 config overlay 关掉 extract.enabled 再落盘"),
          h("div", { style: { ...row, marginTop: "4px" } },
            h("select", { style: input, value: form.family, onChange: (e) => setForm({ ...form, family: e.target.value }) },
              h("option", { value: "chat" }, "个人"),
              h("option", { value: "work" }, "工作"),
            ),
            h("select", { style: input, value: form.kind, onChange: (e) => setForm({ ...form, kind: e.target.value }) },
              h("option", { value: "judgment" }, "判断错"),
              h("option", { value: "recall-miss" }, "该召没召"),
              h("option", { value: "recall-noise" }, "召来噪音"),
              h("option", { value: "route" }, "路由错"),
            ),
            h("span", { style: { flex: 1 } }),
            h("button", { style: btnPrimary, onClick: save }, "保存"),
          ),
        ) : null,
        data === null ? h("div", { style: { color: C.muted } }, "加载中…")
          : data.biases.length === 0 ? h("div", { style: card, color: C.muted }, "还没有偏差档案。模型可在出错当场用 memory_bias 入档，这里也能手动补。")
          : h("div", null, data.biases.map((b) => h("div", { key: b.id, style: card },
            h("div", { style: row },
              tag(C.muted, `B-${b.no}`),
              tag(BIAS_KIND_COLOR[b.kind] || C.muted, BIAS_KIND_LABEL[b.kind] || b.kind),
              tag(FAMILY_COLOR[b.family] || C.muted, FAMILY_LABEL[b.family] || b.family),
              h("span", { style: { fontSize: "12px", color: C.muted } }, b.date || ""),
              h("span", { style: { flex: 1 } }),
              b.hits ? h("span", { style: { fontSize: "12px", color: C.muted } }, `召回 ${b.hits} 次`) : null,
              h("button", { style: btnDanger, onClick: async () => { await post("/api-memory/biases", { action: "delete", id: b.id }); load(); } }, "删除"),
            ),
            h("div", { style: { marginTop: "8px", fontSize: "13px", lineHeight: 1.7 } },
              b.scene ? h("div", null, h("b", null, "场景："), b.scene) : null,
              h("div", null, h("b", null, "偏差："), b.deviation),
              b.rootCause ? h("div", null, h("b", null, "根因："), b.rootCause) : null,
              h("div", null, h("b", null, "修正："), b.fix),
            ),
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
      ["bias", "bias.enabled", "偏差档案", "话题撞上时把我过去判错的场景与修正一并注入"],
      ["audit", "audit.autoMerge", "自动合并近重复", "每次蒸馏后自动合并高置信度近重复（可一键撤销）"],
      ["embedding.enabled", "embedding.enabled", "向量检索", "配置远程嵌入服务后启用 hybrid 检索"],
      ["knowledge.enabled", "knowledge.enabled", "知识库索引", "扫描本地知识库目录，把文件内容变成可检索资产"],
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
      ["llm.maxInputChars", "蒸馏输入预算（字符，超限分块）"],
    ];

    function getIn(obj, path) {
      return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
    }
    function setIn(obj, path, value) {
      const next = structuredClone(obj);
      const keys = path.split(".");
      let cur = next;
      for (let i = 0; i < keys.length - 1; i++) {
        if (typeof cur[keys[i]] !== "object" || cur[keys[i]] === null) cur[keys[i]] = {};
        cur = cur[keys[i]];
      }
      cur[keys[keys.length - 1]] = value;
      return next;
    }

    /** 路由链文本域 ↔ 配置数组：每行 `provider|model[|effort]`。 */
    function chainToText(chain) {
      return (chain || []).map((r) => [r.provider, r.model, r.reasoningEffort || ""].filter((x, i) => i < 2 || x).join("|")).join("\n");
    }
    function textToChain(text) {
      const out = [];
      for (const line of String(text || "").split("\n")) {
        const t = line.trim();
        if (!t) continue;
        const parts = t.split("|").map((p) => p.trim());
        if (!parts[0] || !parts[1]) continue;
        out.push({ provider: parts[0], model: parts[1], reasoningEffort: parts[2] || "" });
      }
      return out;
    }

    function SessionsCard() {
      const [data, setData] = useState(null);
      const [msg, setMsg] = useState("");
      const load = useCallback(async () => {
        try { setData(await api("/api-memory/sessions")); } catch { /* 忽略 */ }
      }, []);
      useEffect(() => {
        load();
        const timer = setInterval(load, 8000);
        return () => clearInterval(timer);
      }, [load]);
      const setMode = async (sid, mode) => {
        try {
          // mode null = 清除覆盖跟随全局；'' 视为 null
          const d = await post("/api-memory/sessions", { sid, mode: mode || null });
          setData(d);
          setMsg(`会话 ${sid.slice(0, 10)}… 档位已更新`);
        } catch (e) { setMsg("失败: " + e.message); }
        setTimeout(() => setMsg(""), 2000);
      };
      const setFlow = async (sid, flow) => {
        try {
          const recall = flow === "follow" ? null : flow === "wo" ? false : true;
          const d = await post("/api-memory/sessions", { sid, recall });
          setData(d);
          setMsg(`会话 ${sid.slice(0, 10)}… 数据流已更新`);
        } catch (e) { setMsg("失败: " + e.message); }
        setTimeout(() => setMsg(""), 2000);
      };
      const sessions = (data && data.sessions || []).filter((s) => s.hasL0 || s.mode);
      return h("div", { style: card },
        h("div", { style: { ...row, justifyContent: "space-between", marginBottom: "8px" } },
          h("div", { style: { fontWeight: 600 } }, "会话记忆档位"),
          h("div", { style: row },
            h("span", { style: { fontSize: "12px", color: C.muted } }, "新会话默认档"),
            h("span", { style: { fontSize: "13px", fontWeight: 600 } }, data ? MODE_LABEL[data.defaultMode] || data.defaultMode : "…"),
            h("button", { style: btn, onClick: load }, "刷新"),
          ),
        ),
        h("div", { style: { fontSize: "12px", color: C.muted, marginBottom: "8px" } },
          "智能=双族自动归档；日常=只进个人域；工作=只进工作域；暂停=本会话对记忆系统隐身（不捕获不注入）。数据流「只写」照常沉淀记忆但不在本会话注入。"),
        !data ? h("div", { style: { color: C.muted } }, "加载中…")
          : sessions.length === 0 ? h("div", { style: { color: C.muted, fontSize: "13px" } }, "暂无活跃会话。")
          : h("div", null, sessions.slice(0, 20).map((s, i) => h("div", {
              key: s.sid, style: { display: "flex", gap: "8px", alignItems: "center", padding: "6px 0", borderBottom: i < Math.min(sessions.length, 20) - 1 ? `1px solid ${C.border}` : "none", fontSize: "13px", flexWrap: "wrap" },
            },
              h("span", { style: { fontFamily: "ui-monospace, monospace", fontSize: "12px", color: C.muted } }, s.sid.slice(0, 14) + (s.sid.length > 14 ? "…" : "")),
              tag(MODE_LABEL[s.effectiveMode] ? C.brand : C.muted, MODE_LABEL[s.effectiveMode] || s.effectiveMode),
              s.recall === false ? tag(C.amber, "只写") : null,
              s.mode === "off" ? tag(C.red, "已暂停") : null,
              s.count > 0 ? tag(C.amber, `待蒸馏 ${s.count}`) : null,
              h("span", { style: { flex: 1 } }),
              h("select", { style: { ...input, minWidth: "86px" }, value: s.mode || "", onChange: (e) => setMode(s.sid, e.target.value) },
                h("option", { value: "" }, `跟随全局（${MODE_LABEL[data.defaultMode]}）`),
                h("option", { value: "auto" }, "智能"),
                h("option", { value: "chat" }, "日常"),
                h("option", { value: "work" }, "工作"),
                h("option", { value: "off" }, "暂停"),
              ),
              h("select", { style: { ...input, minWidth: "92px" }, value: s.recall === false ? "wo" : s.recall === true ? "on" : "follow", onChange: (e) => setFlow(s.sid, e.target.value) },
                h("option", { value: "follow" }, "数据流：跟随全局"),
                h("option", { value: "on" }, "读写"),
                h("option", { value: "wo" }, "只写"),
              ),
            ))),
        msg ? h("div", { style: { marginTop: "6px", fontSize: "12px", color: C.green } }, msg) : null,
      );
    }

    function RouteChainCard({ cfg, setCfg }) {
      const fallbacksText = chainToText(getIn(cfg, "llm.fallbacks"));
      const layerText = (key) => chainToText(getIn(cfg, `llm.layerRoutes.${key}`));
      const update = (path, text) => setCfg((prev) => setIn(prev, path, textToChain(text)));
      const area = { ...input, width: "100%", minHeight: "54px", fontFamily: "ui-monospace, monospace", resize: "none", display: "block" };
      return h("div", { style: card },
        h("div", { style: { fontWeight: 600, marginBottom: "4px" } }, "蒸馏路由链"),
        h("div", { style: { fontSize: "12px", color: C.muted, marginBottom: "8px" } },
          "主路由失败（报错/掐断/空输出）时按序自动降级；每条路由各享全额蒸馏超时。每行一条：provider|model[|思考档]，如 opencode-go|deepseek-v4-flash|low。"),
        h("div", { style: { fontSize: "12px", marginBottom: "4px" } }, "全局回退链（主路由之后依次尝试）"),
        h("textarea", { style: area, value: fallbacksText, placeholder: "provider|model[|effort]，每行一条", onChange: (e) => update("llm.fallbacks", e.target.value) }),
        ["l1", "l2", "l3"].map((key) => h("div", { key, style: { marginTop: "8px" } },
          h("div", { style: { fontSize: "12px", marginBottom: "4px" } }, `${key.toUpperCase()} 独立链（留空跟随全局）`),
          h("textarea", { style: { ...area, minHeight: "44px" }, value: layerText(key), placeholder: "头行必须 provider|model", onChange: (e) => update(`llm.layerRoutes.${key}`, e.target.value) }),
        )),
      );
    }

    function EmbeddingCard({ cfg, setCfg }) {
      const [status, setStatus] = useState(null);
      const [msg, setMsg] = useState("");
      const loadStatus = useCallback(async () => {
        try { const d = await api("/api-memory/embedding"); setStatus(d.status); } catch { /* 忽略 */ }
      }, []);
      useEffect(() => {
        loadStatus();
        const timer = setInterval(loadStatus, 5000);
        return () => clearInterval(timer);
      }, [loadStatus]);
      const action = async (body, note) => {
        try {
          const d = await post("/api-memory/embedding", body);
          setMsg(d.ok === false ? `失败: ${d.error || "未知"}` : note);
        } catch (e) { setMsg("失败: " + e.message); }
        loadStatus();
        setTimeout(() => setMsg(""), 2500);
      };
      const f = (path, label, placeholder, type) => h("label", { key: path, style: { ...row, fontSize: "13px" } },
        h("span", { style: { width: "96px" } }, label),
        h("input", { style: { ...input, flex: 1, minWidth: "140px" }, type: type || "text", placeholder: placeholder || "", value: getIn(cfg, path) ?? "", onChange: (e) => setCfg((prev) => setIn(prev, path, type === "number" ? Number(e.target.value) : e.target.value)) }),
      );
      return h("div", { style: card },
        h("div", { style: { ...row, justifyContent: "space-between", marginBottom: "8px" } },
          h("div", { style: { fontWeight: 600 } }, "语义检索（嵌入源）"),
          status ? tag(status.ready ? C.green : status.enabled ? C.amber : C.muted, status.ready ? "就绪" : status.enabled ? "配置不全" : "关闭") : null,
        ),
        h("div", { style: { fontSize: "12px", color: C.muted, marginBottom: "8px" } },
          "OpenAI 兼容 /embeddings 服务（如 https://api.siliconflow.cn/v1）。启用后检索策略自动升级 hybrid（关键词 RRF 融合向量）；任何嵌入失败自动降级关键词，不阻塞对话。"),
        h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "6px" } },
          f("embedding.baseUrl", "服务地址", "https://api.siliconflow.cn/v1"),
          f("embedding.apiKey", "API Key", "sk-…"),
          f("embedding.model", "模型", "BAAI/bge-m3"),
          f("embedding.dimensions", "维度", "必须与模型输出一致", "number"),
          f("embedding.maxInputChars", "单条上限（字符）", "", "number"),
          f("embedding.timeoutMs", "超时（ms）", "", "number"),
        ),
        status ? h("div", { style: { marginTop: "8px", fontSize: "12px", color: C.muted } },
          `已索引 ${status.indexed} 条${status.sourceChanged ? "（源已切换，待重嵌）" : ""}${status.reindexing ? ` · 重嵌中 ${status.reindexProgress.done}/${status.reindexProgress.total}` : ""}${status.circuitOpen ? " · 熔断中（自动降级关键词）" : ""}${status.lastError ? ` · 最近错误: ${status.lastError}` : ""}`,
        ) : null,
        h("div", { style: { ...row, marginTop: "8px" } },
          h("button", { style: btn, onClick: () => action({ action: "reindex" }, "重嵌已完成") }, "重建向量索引"),
          status && status.reindexing ? h("button", { style: btn, onClick: () => action({ action: "cancel" }, "已请求取消") }, "取消重嵌") : null,
          h("button", { style: btnDanger, onClick: () => action({ action: "clear" }, "向量缓存已清空") }, "清空向量"),
          msg ? h("span", { style: { fontSize: "12px", color: msg.startsWith("失败") ? C.red : C.green } }, msg) : null,
        ),
      );
    }

    function KnowledgeCard({ cfg, setCfg }) {
      const [status, setStatus] = useState(null);
      const [msg, setMsg] = useState("");
      const loadStatus = useCallback(async () => {
        try { const d = await api("/api-memory/knowledge"); setStatus(d.status); } catch { /* 忽略 */ }
      }, []);
      useEffect(() => {
        loadStatus();
        const timer = setInterval(loadStatus, 8000);
        return () => clearInterval(timer);
      }, [loadStatus]);
      const pathsText = (getIn(cfg, "knowledge.paths") || []).join("\n");
      const setPaths = (text) => setCfg((prev) => setIn(prev, "knowledge.paths", text.split("\n").map((s) => s.trim()).filter(Boolean)));
      const rescan = async () => {
        try {
          const d = await post("/api-memory/knowledge", { action: "rescan" });
          if (d.ok === false) setMsg("失败: " + (d.error || "未知"));
          else if (d.result && d.result.skipped) setMsg("知识库未启用或未配置目录");
          else setMsg(`扫描完成：新索引 ${d.result.indexed} 个文件（共 ${d.result.files} 文件 / ${d.result.chunks} 片段）`);
        } catch (e) { setMsg("失败: " + e.message); }
        loadStatus();
        setTimeout(() => setMsg(""), 3500);
      };
      const area = { ...input, width: "100%", minHeight: "52px", fontFamily: "ui-monospace, monospace", resize: "vertical" };
      return h("div", { style: card },
        h("div", { style: { ...row, justifyContent: "space-between", marginBottom: "8px" } },
          h("div", { style: { fontWeight: 600 } }, "知识库索引"),
          status ? tag(status.enabled ? (status.files > 0 ? C.green : C.amber) : C.muted,
            status.enabled
              ? (status.files > 0 ? `就绪 ${status.files} 文件 / ${status.chunks} 片段${status.semanticReady ? ` · 语义 ${status.vectorCount}/${status.chunks}` : ""}` : "未索引到文件")
              : "关闭") : null,
        ),
        h("div", { style: { fontSize: "12px", color: C.muted, marginBottom: "8px" } },
          "扫描本地知识库目录（如 Obsidian 库），把 md/txt 内容按段落分块并入召回——模型直接拿到文件内容，而不是只知道位置。自动跳过 .obsidian/.git 等噪音目录；保存后每 10 分钟增量扫描；配置嵌入源后片段自动升级语义检索（hybrid）。"),
        h("textarea", { style: area, placeholder: "每行一个目录，例如 C:\\Users\\me\\Documents\\MyVault", value: pathsText, onChange: (e) => setPaths(e.target.value) }),
        h("div", { style: { ...row, marginTop: "8px", flexWrap: "wrap" } },
          h("span", { style: { fontSize: "12px", color: C.muted } }, "每轮片段上限"),
          h("input", { style: { ...input, width: "60px" }, type: "number", min: 1, max: 10, value: getIn(cfg, "knowledge.maxResults") ?? 3, onChange: (e) => setCfg((prev) => setIn(prev, "knowledge.maxResults", Number(e.target.value))) }),
          h("span", { style: { fontSize: "12px", color: C.muted } }, "总字符预算"),
          h("input", { style: { ...input, width: "72px" }, type: "number", value: getIn(cfg, "knowledge.maxTotalChars") ?? 1200, onChange: (e) => setCfg((prev) => setIn(prev, "knowledge.maxTotalChars", Number(e.target.value))) }),
          h("button", { style: btn, onClick: rescan }, "立即扫描"),
          msg ? h("span", { style: { fontSize: "12px", color: msg.startsWith("失败") ? C.red : C.green } }, msg) : null,
        ),
        status && status.lastError ? h("div", { style: { marginTop: "6px", fontSize: "12px", color: C.red } }, `最近错误: ${status.lastError}`) : null,
      );
    }

    function AutomationTab() {
      const [cfg, setCfg] = useState(null);
      const [saved, setSaved] = useState("");
      useEffect(() => { api("/api-memory/config").then((d) => setCfg(d.effective)).catch(() => setCfg({})); }, []);
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
            h("input", { type: "checkbox", checked: Boolean(getIn(cfg, path)), onChange: (e) => setCfg((prev) => setIn(prev, path, e.target.checked)) }),
            h("span", { style: { width: "110px" } }, label),
            h("span", { style: { color: C.muted } }, desc),
          )),
        ),
        h("div", { style: card },
          h("div", { style: { fontWeight: 600, marginBottom: "8px" } }, "默认记忆档位"),
          h("div", { style: { fontSize: "12px", color: C.muted, marginBottom: "8px" } },
            "新会话的默认档位；已有会话可在下方会话列表单独覆盖。"),
          h("select", { style: input, value: cfg.family || "auto", onChange: (e) => setCfg((prev) => setIn(prev, "family", e.target.value)) },
            h("option", { value: "auto" }, "智能（双族自动归档）"),
            h("option", { value: "chat" }, "日常（个人域）"),
            h("option", { value: "work" }, "工作（工作域）"),
          ),
        ),
        h(SessionsCard, null),
        h(RouteChainCard, { cfg, setCfg }),
        h(EmbeddingCard, { cfg, setCfg }),
        h(KnowledgeCard, { cfg, setCfg }),
        h("div", { style: card },
          h("div", { style: { fontWeight: 600, marginBottom: "8px" } }, "蒸馏与召回参数"),
          h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "8px" } },
            NUMBERS.map(([path, label]) => h("label", { key: path, style: { ...row, fontSize: "13px" } },
              h("span", { style: { flex: 1 } }, label),
              h("input", { style: { ...input, width: "90px" }, type: "number", value: getIn(cfg, path) ?? "", onChange: (e) => setCfg((prev) => setIn(prev, path, Number(e.target.value))) }),
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
    const MODEL_COLORS = ["#6f83ff", "#16a34a", "#d97706", "#a855f7", "#dc2626", "#0ea5e9"];

    function TrendChart({ trend }) {
      if (!trend || trend.length === 0) return null;
      const models = [...new Set(trend.map((t) => t.model))];
      const buckets = [...new Set(trend.map((t) => t.bucket))].sort();
      const byModel = models.map((m) => ({
        model: m,
        points: buckets.map((b) => {
          const hit = trend.find((t) => t.model === m && t.bucket === b);
          return hit ? hit.outputTokens : 0;
        }),
      }));
      const max = Math.max(1, ...byModel.flatMap((p) => p.points));
      const W = 560;
      const H = 120;
      const stepX = buckets.length > 1 ? W / (buckets.length - 1) : 0;
      const line = (points) => points.map((v, i) => `${i === 0 ? "M" : "L"}${(i * stepX).toFixed(1)},${(H - (v / max) * (H - 14)).toFixed(1)}`).join(" ");
      return h("div", null,
        h("svg", { viewBox: `0 0 ${W} ${H}`, style: { width: "100%", height: "120px", marginTop: "8px" } },
          buckets.length === 1 ? byModel.map((p, i) => h("rect", {
            key: p.model, x: W / 2 - 12, y: H - Math.max(2, (p.points[0] / max) * (H - 14)), width: 24, height: Math.max(2, (p.points[0] / max) * (H - 14)), fill: MODEL_COLORS[i % MODEL_COLORS.length], opacity: 0.8,
          })) : byModel.map((p, i) => h("path", {
            key: p.model, d: line(p.points), fill: "none", stroke: MODEL_COLORS[i % MODEL_COLORS.length], strokeWidth: "1.8",
          })),
        ),
        h("div", { style: { ...row, marginTop: "4px" } },
          byModel.map((p, i) => h("span", { key: p.model, style: { fontSize: "11px", color: MODEL_COLORS[i % MODEL_COLORS.length] } }, `■ ${p.model}`)),
          h("span", { style: { flex: 1 } }),
          h("span", { style: { fontSize: "11px", color: C.muted } }, buckets.length > 0 ? `${buckets[0]} ~ ${buckets[buckets.length - 1]}` : ""),
        ),
      );
    }

    // 记忆体检：覆盖率 / 头部垄断 / 沉睡 / 近重复合并（逐组确认，不自动合并）
    function fmtDur(ms) {
      const sec = Math.max(0, Math.round((Number(ms) || 0) / 1000));
      if (sec < 60) return `${sec}s`;
      return `${Math.floor(sec / 60)}m${String(sec % 60).padStart(2, "0")}s`;
    }

    function ProgressBar(props) {
      const pct = Math.max(0, Math.min(100, Number(props.pct) || 0));
      return h("div", { style: { height: "6px", borderRadius: "3px", background: C.border, marginTop: "6px", overflow: "hidden" } },
        h("div", { style: { height: "6px", width: `${pct}%`, background: C.brand, transition: "width .3s ease" } }));
    }

    function HealthCard() {
      const [report, setReport] = useState(null);
      const [busy, setBusy] = useState("");
      const [note, setNote] = useState("");
      const [open, setOpen] = useState(false);
      const [pending, setPending] = useState(null);
      const [scenes, setScenes] = useState(null);
      const [build, setBuild] = useState(null);
      const [test, setTest] = useState(null);
      const [testOpen, setTestOpen] = useState(false);
      const running = !!(build && build.running);
      const load = useCallback(async () => {
        try {
          const r = await api("/api-memory/audit?groups=30");
          setReport(r.report || null);
          setPending(r.pending || null);
          setScenes(r.scenes || null);
          if (r.build) setBuild(r.build);
        } catch { setReport(null); }
      }, []);
      useEffect(() => { load(); }, [load]);
      // 后台整合中：每 2 秒拉一次轻量进度（不重算体检），跑完自动刷新并落一句结果
      useEffect(() => {
        if (!running) return undefined;
        let alive = true;
        const timer = setInterval(async () => {
          try {
            const r = await api("/api-memory/scenes/build");
            if (!alive || !r.build) return;
            setBuild(r.build);
            if (r.pending) setPending(r.pending);
            if (!r.build.running) {
              setNote(`场景整合完成：${r.build.batches} 批，待整合 ${r.build.pendingBefore} → ${r.build.pendingAfter} 条（用时 ${fmtDur(r.build.elapsedMs)}）`);
              load();
            }
          } catch { /* 下一轮再试 */ }
        }, 2000);
        return () => { alive = false; clearInterval(timer); };
      }, [running, load]);
      async function merge(group) {
        const dropIds = group.members.filter((m) => m.id !== group.keepId).map((m) => m.id);
        setBusy(group.keepId);
        setNote("");
        try {
          const r = await post("/api-memory/records/merge", { keepId: group.keepId, dropIds, content: group.suggestedContent });
          setNote(`已合并 ${r.dropped} 条 → 保留 ${group.keepId}`);
          await load();
        } catch (e) { setNote(`合并失败：${e.message || e}`); }
        finally { setBusy(""); }
      }
      async function autoMerge() {
        setBusy("__auto");
        setNote("自动合并中…");
        try {
          const r = await post("/api-memory/records/merge", { auto: true });
          setNote(r.groups > 0 ? `自动合并 ${r.groups} 组 / 并入 ${r.dropped} 条（阈值 ${r.threshold}）` : `没有达到自动合并门槛（${r.threshold}）的组`);
          await load();
        } catch (e) { setNote(`自动合并失败：${e.message || e}`); }
        finally { setBusy(""); }
      }
      async function startBuild() {
        setBusy("__scenes");
        setNote("正在启动后台整合…");
        try {
          const r = await post("/api-memory/scenes/build", { batches: 40 });
          const st = r.started || {};
          if (r.build) setBuild(r.build);
          if (st.started) {
            setNote(`已开始：待整合 ${st.pendingBefore} 条 ≈ ${st.total || "?"} 批，每 2 秒刷新进度`);
          } else if (st.busy) {
            setNote("有蒸馏任务正在跑，稍等 30 秒再点");
          } else {
            setNote("整合已经在跑，进度就在下面");
            if (r.build) setBuild(r.build);
          }
        } catch (e) { setNote(`整合场景失败：${e.message || e}`); }
        finally { setBusy(""); }
      }
      async function undoMerge(all) {
        setBusy("__undo");
        setNote("");
        try {
          const r = await post("/api-memory/records/merge-undo", all ? { all: true } : {});
          setNote(r.batches > 0 ? `已撤销 ${r.batches} 批合并 / 恢复 ${r.restored} 条` : "没有可撤销的合并");
          await load();
        } catch (e) { setNote(`撤销失败：${e.message || e}`); }
        finally { setBusy(""); }
      }
      async function recheck() {
        setBusy("__audit");
        setNote("正在重新体检…");
        try {
          await load();
          setNote(`体检已刷新（${new Date().toLocaleTimeString()}）`);
        } catch (e) { setNote(`刷新失败：${e.message || e}`); }
        finally { setBusy(""); }
      }
      async function sceneMerge() {
        setBusy("__scenemerge");
        setNote("正在合并同名场景…");
        try {
          const r = await post("/api-memory/scenes/merge", { auto: true });
          setNote(r.groups > 0 ? `合并 ${r.groups} 组同名场景 / 并入 ${r.merged} 条` : "没有同名场景需要合并");
          await load();
        } catch (e) { setNote(`场景合并失败：${e.message || e}`); }
        finally { setBusy(""); }
      }
      async function dropSleeping(item) {
        setBusy(item.id);
        setNote("");
        try {
          await post("/api-memory/records/delete", { id: item.id });
          setNote("已删除 1 条沉睡记忆");
          await load();
        } catch (e) { setNote(`删除失败：${e.message || e}`); }
        finally { setBusy(""); }
      }
      // 记忆测试卡：抽旧记忆、只给一半提示，看召回准不准（只读，不改记忆）
      async function runRecallTest() {
        setBusy("__test");
        setNote("正在跑记忆测试卡…");
        try {
          const r = await api("/api-memory/recall-test");
          setTest(r.test || null);
          setNote(r.summary || "记忆测试卡已跑完");
        } catch (e) { setNote(`测试卡失败：${e.message || e}`); }
        finally { setBusy(""); }
      }
      const head0 = h("div", { style: { ...row, justifyContent: "space-between" } },
        h("div", { style: { fontWeight: 600 } }, "记忆体检"),
        h("div", { style: row },
          note ? h("span", { style: { fontSize: "12px", color: C.muted, maxWidth: "360px" } }, note) : null,
          h("button", { style: { ...btn, padding: "4px 10px" }, disabled: busy === "__auto" || running, onClick: autoMerge },
            busy === "__auto" ? "合并中…" : "自动合并"),
          h("button", { style: { ...btn, padding: "4px 10px" }, disabled: busy === "__scenemerge" || running, onClick: sceneMerge },
            busy === "__scenemerge" ? "合并中…" : "合并同名场景"),
          h("button", { style: { ...btn, padding: "4px 10px" }, disabled: busy === "__scenes" || running, onClick: startBuild },
            running ? "整合中…" : busy === "__scenes" ? "启动中…" : "整合场景积压"),
          h("button", { style: { ...btn, padding: "4px 10px" }, disabled: busy === "__undo" || running, onClick: () => undoMerge(false) },
            busy === "__undo" ? "撤销中…" : "撤销上次合并"),
          h("button", { style: { ...btn, padding: "4px 10px" }, disabled: busy === "__audit", onClick: recheck },
            busy === "__audit" ? "体检中…" : "重新体检")));
      const etaMs = running && build.batches > 0 && build.total > build.batches
        ? (build.elapsedMs / build.batches) * (build.total - build.batches)
        : 0;
      const progressBlock = running
        ? h("div", { style: { marginTop: "10px" } },
            h("div", { style: { ...row, justifyContent: "space-between", fontSize: "12px", color: C.muted } },
              h("span", null, `正在整合场景：第 ${build.batches}/${build.total || "?"} 批${build.lastFamily ? `（${build.lastFamily}）` : ""}`),
              h("span", null, `剩余待整合 ${build.pendingAfter} 条｜已跑 ${fmtDur(build.elapsedMs)}｜预计还需 ${etaMs > 0 ? fmtDur(etaMs) : "计算中"}`)),
            h(ProgressBar, { pct: build.total ? (build.batches / build.total) * 100 : 0 }))
        : build && build.finishedAt
          ? h("div", { style: { fontSize: "12px", color: C.muted, marginTop: "8px" } },
              `上次整合：${build.batches} 批，待整合 ${build.pendingBefore} → ${build.pendingAfter} 条（用时 ${fmtDur(build.elapsedMs)}）${build.skipped ? `｜跳过 ${build.skipped} 条（模型输出受限，内容更新后重试）` : ""}${build.error ? `｜出错：${build.error}` : ""}`)
          : null;
      if (!report) {
        return h("div", { style: card }, head0, progressBlock,
          h("div", { style: { color: C.muted, fontSize: "13px", marginTop: "6px" } }, "加载中…"));
      }
      const c = report.coverage || {};
      const head = report.head || {};
      const sleep = report.sleeping || {};
      const dup = report.duplicates || {};
      const sc = scenes || {};
      const len = report.length || {};
      const kinds = report.byKind || {};
      return h("div", { style: card },
        head0,
        progressBlock,
        h("div", { style: { ...row, gap: "12px", marginTop: "10px" } },
          tile("记忆总量", report.total),
          tile("召回覆盖率", `${c.hitPct}%`),
          tile("从未召回", c.zero),
          tile("沉睡", sleep.count),
          tile("近重复组", dup.groupCount),
          tile("可合并", dup.mergable),
          tile("场景", sc.total == null ? "—" : sc.total),
          tile("待整合", pending ? pending.chat + pending.work : "—")),
        h("div", { style: { fontSize: "12px", color: C.muted, marginTop: "8px" } },
          `头部垄断：命中 ≥10 次 ${head.manyHits} 条｜沉睡口径 ${sleep.sleepDays} 天｜长度中位 ${len.median}·p90 ${len.p90}｜fact ${kinds.fact} / opinion ${kinds.opinion} / commitment ${kinds.commitment}`),
        dup.groupCount > 0 ? h("div", { style: { marginTop: "12px" } },
          h("div", { style: { ...row, justifyContent: "space-between" } },
            h("div", { style: { fontWeight: 600, fontSize: "13px" } }, `近重复 ${dup.groupCount} 组 · 可合并 ${dup.mergable} 条`),
            h("button", { style: { ...btn, padding: "4px 10px" }, onClick: () => setOpen(!open) }, open ? "收起" : "展开逐组合并")),
          open ? h("div", { style: { marginTop: "8px" } }, (dup.groups || []).map((g) => h("div", {
            key: g.keepId,
            style: { borderTop: `1px solid ${C.border}`, padding: "8px 0" },
          },
            h("div", { style: { fontSize: "12px", color: C.muted } }, `${g.size} 条 · 族 ${g.family} · 合并后 hits ${g.mergedHits}`),
            h("div", { style: { fontSize: "13px", margin: "4px 0" } }, String(g.suggestedContent || "").slice(0, 120)),
            h("div", { style: row },
              h("button", {
                style: { ...btn, padding: "3px 9px" },
                disabled: busy === g.keepId,
                onClick: () => merge(g),
              }, busy === g.keepId ? "合并中…" : "合并这组"),
              h("span", { style: { fontSize: "12px", color: C.muted } }, `保留 ${g.keepId}，并入 ${g.size - 1} 条`))))) : null,
        ) : null,
        sleep.count > 0 ? h("div", { style: { marginTop: "12px" } },
          h("div", { style: { fontWeight: 600, fontSize: "13px" } }, `沉睡记忆 ${sleep.count} 条（超过 ${sleep.sleepDays} 天没被召回）`),
          h("div", { style: { fontSize: "12px", color: C.muted, margin: "4px 0 2px" } }, "它们占着索引位置却从没被召回。确认没用再删，删了不可恢复："),
          (sleep.samples || []).map((item) => h("div", {
            key: item.id,
            style: { borderTop: `1px solid ${C.border}`, padding: "6px 0", display: "flex", gap: "10px", alignItems: "flex-start" },
          },
            h("div", { style: { fontSize: "13px", flex: 1 } }, String(item.content || item.excerpt || "").slice(0, 140)),
            h("span", { style: { fontSize: "12px", color: C.muted, whiteSpace: "nowrap" } }, `${item.days || "?"} 天`),
            h("button", { style: { ...btn, padding: "3px 9px" }, disabled: busy === item.id, onClick: () => dropSleeping(item) },
              busy === item.id ? "删除中…" : "删除")))) : null,
        // 记忆测试卡：体检的第五个维度——召回准不准（只读）
        h("div", { style: { marginTop: "12px", borderTop: `1px solid ${C.border}`, paddingTop: "12px" } },
          h("div", { style: { ...row, justifyContent: "space-between" } },
            h("div", { style: { fontWeight: 600, fontSize: "13px" } }, "召回质量测试卡"),
            h("div", { style: row },
              h("button", { style: { ...btn, padding: "4px 10px" }, disabled: busy === "__test", onClick: runRecallTest },
                busy === "__test" ? "测试中…" : test ? "再跑一次" : "跑测试卡"),
              test ? h("button", { style: { ...btn, padding: "4px 10px" }, onClick: () => setTestOpen(!testOpen) },
                testOpen ? "收起" : "看考题") : null)),
          h("div", { style: { fontSize: "12px", color: C.muted, marginTop: "4px" } },
            "抽够旧的记忆当考题，只给一半提示，看召回时能不能把它排进前列——体检的其余指标只看结构，这张卡看的是「召回得准不准」。只读，不改记忆。"),
          test ? h("div", { style: { ...row, gap: "12px", marginTop: "10px" } },
            tile("得分", `${test.score}`),
            tile("命中", test.hit),
            tile("半对", test.half),
            tile("记错", test.miss),
            tile("考题池", test.poolSize)) : null,
          test && test.items && test.items.length > 0 ? h("div", { style: { fontSize: "12px", color: C.muted, marginTop: "6px" } },
            `池龄 ≥${test.minAgeDays} 天｜前 ${test.topK} 名算半对、第 1 名算命中｜样例池 ${test.poolSize} 条`) : null,
          testOpen && test && test.items && test.items.length > 0 ? h("div", { style: { marginTop: "8px" } },
            (test.items || []).map((t) => h("div", {
              key: t.id,
              style: { borderTop: `1px solid ${C.border}`, padding: "8px 0" },
            },
              h("div", { style: { fontSize: "12px", color: C.muted } },
                `${t.verdict === "hit" ? "命中" : t.verdict === "half" ? "半对" : "记错"}｜排第 ${t.rank || "—"} 名｜${t.ageDays} 天前｜族 ${t.family}`),
              h("div", { style: { fontSize: "13px", margin: "4px 0" } }, `提示：${t.hint}`),
              h("div", { style: { fontSize: "12px", color: C.muted } }, `答案：${String(t.answer || "").slice(0, 120)}`),
              h("div", { style: { fontSize: "11px", color: C.muted, marginTop: "2px" } },
                `召回候选：${(t.candidates || []).map((c) => `#${c.id}(${c.score})`).join(" ") || "（无）"}`)))) : null),
      );
    }

    function InsightsTab() {
      const [data, setData] = useState(null);
      const [days, setDays] = useState(7);
      const [granularity, setGranularity] = useState("day");
      const [layer, setLayer] = useState("");
      const load = useCallback(async () => {
        try {
          const params = new URLSearchParams({ days: String(days), granularity });
          if (layer) params.set("layer", layer);
          setData(await api(`/api-memory/insights?${params}`));
        } catch { setData({}); }
      }, [days, granularity, layer]);
      useEffect(() => { load(); }, [load]);
      const maxDay = data ? Math.max(1, ...(data.byDay || []).map((d) => d.outputTokens)) : 1;
      return h("div", null,
        h(HealthCard, null),
        h("div", { style: card },
          h("div", { style: { ...row, justifyContent: "space-between", marginBottom: "8px" } },
            h("div", { style: { fontWeight: 600 } }, "蒸馏成本"),
            h("div", { style: row },
              h("select", { style: { ...input, minWidth: "90px" }, value: String(days), onChange: (e) => setDays(Number(e.target.value)) },
                [1, 7, 14, 30, 90, 365].map((d) => h("option", { key: d, value: d }, `近 ${d} 天`))),
              h("select", { style: input, value: granularity, onChange: (e) => setGranularity(e.target.value) },
                h("option", { value: "day" }, "按天"), h("option", { value: "week" }, "按周"), h("option", { value: "month" }, "按月")),
              h("select", { style: input, value: layer, onChange: (e) => setLayer(e.target.value) },
                h("option", { value: "" }, "全部层级"), h("option", { value: "l1" }, "L1 抽取"), h("option", { value: "l2" }, "L2 场景"), h("option", { value: "l3" }, "L3 画像")),
            ),
          ),
          h(TrendChart, { trend: data && data.trend }),
        ),
        h("div", { style: card },
          h("div", { style: { fontWeight: 600, marginBottom: "8px" } }, "资产活动"),
          h("div", { style: { display: "flex", alignItems: "flex-end", gap: "4px", height: "80px", marginTop: "10px" } },
            (data && data.byDay || []).map((d) => h("div", { key: d.day, style: { flex: 1, textAlign: "center" } },
              h("div", { style: { height: `${Math.max(2, (d.outputTokens / maxDay) * 64)}px`, background: C.brand, borderRadius: "3px 3px 0 0", opacity: 0.85 } }),
              h("div", { style: { fontSize: "10px", color: C.muted, marginTop: "2px" } }, d.day.slice(5)),
            )),
          ),
          h("div", { style: { ...row, marginTop: "6px" } },
            h("span", { style: { fontSize: "13px", color: C.muted } }, "新增记忆："),
            h("strong", null, (data && data.byDay || []).reduce((s, d) => s + (d.added || 0), 0)),
            h("span", { style: { fontSize: "13px", color: C.muted, marginLeft: "16px" } }, "蒸馏调用："),
            h("strong", null, (data && data.byDay || []).reduce((s, d) => s + (d.calls || 0), 0)),
          ),
        ),
        h("div", { style: card },
          h("div", { style: { fontWeight: 600, marginBottom: "8px" } }, "召回与会话"),
          h("div", { style: row },
            h("span", { style: { fontSize: "13px", color: C.muted } }, "累计注入轮次"),
            h("strong", null, String((data && data.recall && data.recall.recallInjections) || 0)),
            h("span", { style: { fontSize: "13px", color: C.muted, marginLeft: "16px" } }, "累计注入记忆"),
            h("strong", null, String((data && data.recall && data.recall.recallRecords) || 0)),
            h("span", { style: { fontSize: "13px", color: C.muted, marginLeft: "16px" } }, "最后注入"),
            h("span", null, relTime(data && data.recall && data.recall.lastRecallAt)),
          ),
          data && data.sessionModes ? h("div", { style: { marginTop: "6px", fontSize: "13px" } },
            `会话停用分布：暂停 ${data.sessionModes.off} · 只写 ${data.sessionModes.wo}`,
          ) : null,
        ),
        h("div", { style: card },
          h("div", { style: { fontWeight: 600, marginBottom: "8px" } }, `蒸馏调用明细（近 ${days} 天 · 按模型）`),
          !data || (data.byModel || []).length === 0
            ? h("div", { style: { color: C.muted, fontSize: "13px" } }, "还没有蒸馏调用记录。")
            : h("table", { style: { width: "100%", fontSize: "13px", borderCollapse: "collapse" } },
              h("thead", null, h("tr", null, ["模型", "调用", "失败", "输出 token", "思考 token", "均值", "中位数", "输入字符"].map((th) =>
                h("th", { key: th, style: { textAlign: "left", padding: "4px 8px", borderBottom: `1px solid ${C.border}`, color: C.muted, fontWeight: 500 } }, th)))),
              h("tbody", null, data.byModel.map((m) => h("tr", { key: m.model },
                h("td", { style: { padding: "4px 8px" } }, m.model),
                h("td", { style: { padding: "4px 8px" } }, m.calls),
                h("td", { style: { padding: "4px 8px", color: m.failures > 0 ? C.red : "inherit" } }, m.failures),
                h("td", { style: { padding: "4px 8px" } }, fmtTokens(m.outputTokens)),
                h("td", { style: { padding: "4px 8px" } }, fmtTokens(m.reasoningTokens)),
                h("td", { style: { padding: "4px 8px" } }, fmtTokens(m.avgOutput)),
                h("td", { style: { padding: "4px 8px" } }, fmtTokens(m.medianOutput)),
                h("td", { style: { padding: "4px 8px" } }, fmtTokens(m.inChars)),
              ))),
            ),
          (data && data.byLayer || []).length > 0 ? h("div", { style: { marginTop: "8px", fontSize: "12px", color: C.muted } },
            `层级分布：${data.byLayer.map((l) => `${l.layer} ${l.calls} 次 / ${fmtTokens(l.outputTokens)} tok`).join(" · ")}`,
          ) : null,
          (data && data.failures || []).length > 0 ? h("div", { style: { marginTop: "10px", fontSize: "12px", color: C.red } },
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
      // ---------- 跨设备同步 ----------
      const [syncSt, setSyncSt] = useState(null);
      const [syncForm, setSyncForm] = useState(null);
      const [syncBusy, setSyncBusy] = useState("");
      const [syncStart, setSyncStart] = useState(0);
      const [syncTick, setSyncTick] = useState(0);
      const [syncMsg, setSyncMsg] = useState(null);
      // 跨境拉 600KB 快照要二三十秒，没有可见进度用户会以为点了没反应
      useEffect(() => {
        if (!syncBusy) return undefined;
        const t = setInterval(() => setSyncTick((n) => n + 1), 1000);
        return () => clearInterval(t);
      }, [syncBusy]);
      const syncWaited = syncStart ? Math.max(0, Math.round((Date.now() - syncStart) / 1000)) : 0;
      const loadSync = useCallback(async () => {
        try { setSyncSt(await api("/api-memory/sync/status")); } catch { /* 忽略 */ }
      }, []);
      useEffect(() => { loadSync(); }, [loadSync]);
      const syncField = (key, label, placeholder, type) => h("div", { style: { marginBottom: "8px" } },
        h("div", { style: { fontSize: "12px", color: C.muted, marginBottom: "3px" } }, label),
        h("input", {
          style: { ...input, width: "100%" }, placeholder, type: type || "text",
          value: (syncForm && syncForm[key]) || "",
          onChange: (e) => setSyncForm({ ...(syncForm || {}), [key]: e.target.value }),
        }),
      );
      const saveSyncCfg = async () => {
        try {
          const f = syncForm || {};
          // token 留空 = 保持原值（面板不回显 token，避免明文暴露在界面上）
          const patch = {
            enabled: f.enabled !== false,
            repo: String(f.repo || "").trim(),
            branch: String(f.branch || "main").trim(),
            deviceName: String(f.deviceName || "").trim(),
            includeL0: Boolean(f.includeL0),
          };
          if (String(f.token || "").trim()) patch.token = String(f.token).trim();
          await post("/api-memory/config", { sync: patch });
          setSyncForm(null);
          setSyncMsg({ kind: "ok", text: "同步配置已保存" });
          loadSync();
        } catch (e) { setSyncMsg({ kind: "err", text: "保存失败：" + (e.message || e) }); }
      };
      const doUpload = async () => {
        setSyncBusy("upload");
        setSyncStart(Date.now());
        setSyncMsg(null);
        try {
          const d = await post("/api-memory/sync/upload", {});
          const m = d.mergeStats || {};
          const pulled = (m.recordsAdded || 0) + (m.scenesAdded || 0) + (m.biasesAdded || 0);
          const sha = String(d.commitSha || "").slice(0, 8);
          setSyncMsg({
            kind: pulled > 0 ? "ok" : "warn",
            text: pulled > 0
              ? `已上传 ${(d.bytes / 1024).toFixed(0)}KB · 顺带从远端并入 ${m.recordsAdded || 0} 条记忆、${m.scenesAdded || 0} 个场景 · 提交 ${sha}`
              : `已上传 ${(d.bytes / 1024).toFixed(0)}KB · 远端无新内容 · 提交 ${sha} · 本机已是最新`,
          });
          loadSync();
        } catch (e) { setSyncMsg({ kind: "err", text: "上传失败：" + (e.message || e) }); }
        setSyncBusy("");
        setSyncStart(0);
      };
      const doDownload = async () => {
        setSyncBusy("download");
        setSyncStart(Date.now());
        setSyncMsg(null);
        try {
          const d = await post("/api-memory/sync/download", {});
          const s = d.stats || {};
          const added = (s.recordsAdded || 0) + (s.scenesAdded || 0) + (s.biasesAdded || 0);
          const from = d.remoteDevice || "远端";
          const total = d.total && d.total.records != null ? ` · 现共 ${d.total.records} 条记忆` : "";
          if (d.skipped) {
            // 远端 digest 与上次一致，后端直接跳过下载（0.7 秒返回，不用等跨境传 600KB）
            setSyncMsg({ kind: "warn", text: `已是最新 · 远端「${from}」自上次同步后没有变化，本次未下载${total}` });
          } else {
            setSyncMsg({
              kind: added > 0 ? "ok" : "warn",
              text: added > 0
                ? `已从「${from}」同步 · 新增 ${s.recordsAdded || 0} 条记忆、${s.scenesAdded || 0} 个场景、${s.biasesAdded || 0} 条偏差${total} · 原数据已备份`
                : `已是最新 · 远端「${from}」与本机一致，没有新内容${total}`,
            });
          }
          loadSync();
        } catch (e) {
          const m = String((e && e.message) || e);
          setSyncMsg(e && e.empty
            ? { kind: "warn", text: m }
            : { kind: "err", text: "同步失败：" + m });
        }
        setSyncBusy("");
        setSyncStart(0);
      };
      const syncPanel = h("div", { style: card },
        h("div", { style: { fontWeight: 600, marginBottom: "8px" } }, "跨设备同步（GitHub 快照）"),
        h("div", { style: { fontSize: "13px", color: C.muted, marginBottom: "8px" } },
          "两台设备各装一份，平时只用一台：用完点「上传」，另一台点「同步」拉回来并合并。合并规则＝按 id 并集，同一条以更新时间晚的为准，召回次数取较大值（不累加，避免重复膨胀）。"),
        syncSt ? h("div", { style: { fontSize: "12.5px", marginBottom: "8px" } },
          h("div", null, `本机：${syncSt.deviceName}（${syncSt.deviceId}）· 记忆 ${syncSt.local.records} 条 / 场景 ${syncSt.local.scenes} 个 / 偏差 ${syncSt.local.biases} 条`),
          syncSt.remote ? h("div", null, `远端：${syncSt.remote.deviceName || syncSt.remote.deviceId} 于 ${relTime(syncSt.remote.updatedAt)} 上传 · 记忆 ${syncSt.remote.records} 条 / ${(syncSt.remote.bytes / 1024).toFixed(0)}KB`) : h("div", { style: { color: C.muted } }, "远端：还没有快照"),
          syncSt.remoteError ? h("div", { style: { color: C.red } }, "远端读取失败：" + syncSt.remoteError) : null,
          syncSt.lastSync && (syncSt.lastSync.lastDownload || syncSt.lastSync.lastUpload)
            ? h("div", { style: { color: C.muted, marginTop: "4px" } },
                "上次操作：" + [
                  syncSt.lastSync.lastDownload ? `同步 ${relTime(syncSt.lastSync.lastDownload.at)}（来自 ${syncSt.lastSync.lastDownload.remoteDevice || "远端"}）` : "",
                  syncSt.lastSync.lastUpload ? `上传 ${relTime(syncSt.lastSync.lastUpload.at)}` : "",
                ].filter(Boolean).join(" · "))
            : null,
        ) : null,
        syncForm ? h("div", { style: { marginBottom: "10px" } },
          syncField("repo", "GitHub 仓库（owner/repo）", "Hickey-Yuze/dsh-memory-sync"),
          syncField("token", "GitHub Token（细粒度，只给该仓库 contents 读写）", syncSt && syncSt.hasToken ? "已配置（留空＝不改）" : "github_pat_…", "password"),
          syncField("branch", "分支", "main"),
          syncField("deviceName", "本机名称（可留空，用主机名）", "Mac mini"),
          h("label", { style: { display: "flex", alignItems: "center", gap: "6px", fontSize: "12.5px", marginBottom: "8px" } },
            h("input", { type: "checkbox", checked: Boolean(syncForm.includeL0), onChange: (e) => setSyncForm({ ...syncForm, includeL0: e.target.checked }) }),
            "连 L0 原始对话一起同步（体积 +2MB，一般不需要）",
          ),
          h("div", { style: row },
            h("button", { style: btn, onClick: saveSyncCfg }, "保存配置"),
            h("button", { style: btn, onClick: () => setSyncForm(null) }, "取消"),
          ),
        ) : h("div", { style: row },
          h("button", { style: btn, onClick: () => setSyncForm({
            enabled: true, repo: (syncSt && syncSt.repo) || "", branch: (syncSt && syncSt.branch) || "main",
            token: "", deviceName: (syncSt && syncSt.deviceName) || "", includeL0: Boolean(syncSt && syncSt.includeL0),
          }) }, syncSt && syncSt.configured ? "修改配置" : "配置同步"),
          h("button", { style: btn, disabled: !syncSt || !syncSt.configured || syncBusy === "upload", onClick: doUpload }, syncBusy === "upload" ? "上传中…" : "上传到远端"),
          h("button", { style: btn, disabled: !syncSt || !syncSt.configured || syncBusy === "download", onClick: doDownload }, syncBusy === "download" ? "同步中…" : "从远端同步"),
          h("span", { style: { fontSize: "12px", color: C.muted } }, syncSt && syncSt.configured ? "" : "先配置仓库与 token"),
        ),
        syncBusy ? h("div", {
          style: {
            marginTop: "10px", padding: "9px 12px", borderRadius: "8px",
            border: "1px solid #93b8e8", background: "rgba(59,130,246,0.10)",
            fontSize: "12.5px", lineHeight: 1.55, color: "#1e4e8c",
          },
        },
          h("span", { style: { fontWeight: 700, marginRight: "6px" } }, "⏳"),
          syncBusy === "download"
            ? `正在从远端下载快照并合并（约 600KB，跨境网络一般 20–40 秒）… 已等待 ${syncWaited} 秒，请不要关闭页面。`
            : `正在读取远端快照 → 合并本机 → 再上传（约 20–40 秒）… 已等待 ${syncWaited} 秒，请不要关闭页面。`,
        ) : null,
        syncMsg ? (() => {
          const c = syncMsg.kind === "ok" ? C.green : syncMsg.kind === "warn" ? C.amber : C.red;
          const bg = syncMsg.kind === "ok" ? "rgba(22,163,74,0.10)" : syncMsg.kind === "warn" ? "rgba(217,119,6,0.10)" : "rgba(220,38,38,0.10)";
          const icon = syncMsg.kind === "ok" ? "✓" : syncMsg.kind === "warn" ? "!" : "✕";
          return h("div", {
            style: {
              marginTop: "10px", padding: "9px 12px", borderRadius: "8px",
              border: `1px solid ${c}`, background: bg,
              fontSize: "12.5px", lineHeight: 1.55,
            },
          },
            h("span", { style: { color: c, fontWeight: 700, marginRight: "6px" } }, icon),
            syncMsg.text,
          );
        })() : null,
        syncSt ? h("div", { style: { fontSize: "11.5px", color: C.muted, marginTop: "8px" } },
          "不同步（各机本地）：" + (syncSt.localOnlyFiles || []).join("、"),
        ) : null,
      );
      return h("div", null,
        syncPanel,
        h("div", { style: card },
          h("div", { style: { fontWeight: 600, marginBottom: "8px" } }, "全量重建"),
          h("div", { style: { fontSize: "13px", color: C.muted, marginBottom: "8px" } },
            "丢弃现有 L1–L3 资产，从 L0 会话事实源重新蒸馏（统一 auto 档归族）。L0 原始对话不受影响。"),
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

    // ---------- 输入栏：会话记忆档位芯片（对齐原版 MemoryChip：档位 + 数据流，精简菜单版） ----------
    /** 从 anchor 向上找第一个不透明背景色作为浮层底色（宿主无 popover 令牌时的兜底）。 */
    function opaqueBackdrop(el) {
      let node = el;
      while (node) {
        try {
          const c = getComputedStyle(node).backgroundColor;
          if (c && c !== "transparent" && !/rgba\([^)]+,\s*0\)$/.test(c)) return c;
        } catch { /* 忽略 */ }
        node = node.parentElement;
      }
      return "#ffffff";
    }

    function normalizeSessionId(owner) {
      if (typeof owner === "string") return owner;
      if (owner && typeof owner === "object") return owner.sessionId || owner.sid || null;
      return null;
    }

    function MemoryChip(props) {
      const sid = normalizeSessionId(props.sessionId);
      const [info, setInfo] = useState(null); // { defaultMode, entry }
      const [open, setOpen] = useState(false);
      const [pos, setPos] = useState(null);
      const [err, setErr] = useState("");
      const anchorRef = useRef(null);
      const menuRef = useRef(null);

      const load = useCallback(async () => {
        if (!sid) return;
        try {
          const d = await api("/api-memory/sessions");
          const entry = (d.sessions || []).find((s) => s.sid === sid) || null;
          setInfo({ defaultMode: d.defaultMode || "auto", entry });
        } catch { /* 后端未就绪时保持静默 */ }
      }, [sid]);
      useEffect(() => { load(); }, [load]);
      useEffect(() => {
        const timer = setInterval(load, 10000);
        return () => clearInterval(timer);
      }, [load]);

      useEffect(() => {
        if (!open) return;
        const close = (e) => {
          if (menuRef.current && menuRef.current.contains(e.target)) return;
          if (anchorRef.current && anchorRef.current.contains(e.target)) return;
          setOpen(false);
        };
        const esc = (e) => { if (e.key === "Escape") setOpen(false); };
        document.addEventListener("pointerdown", close, true);
        document.addEventListener("keydown", esc, true);
        return () => {
          document.removeEventListener("pointerdown", close, true);
          document.removeEventListener("keydown", esc, true);
        };
      }, [open]);

      const toggle = () => {
        if (open) { setOpen(false); return; }
        if (!sid || !anchorRef.current) return;
        const r = anchorRef.current.getBoundingClientRect();
        const W = 248;
        const H = 350; // 估算高度：标题 + 5 档位行 + 3 数据流行
        const left = Math.max(12, Math.min(r.left, window.innerWidth - W - 12));
        const flip = r.bottom + H + 8 > window.innerHeight - 12;
        setPos({ left, top: flip ? Math.max(12, r.top - H - 8) : r.bottom + 8 });
        setOpen(true);
        load();
      };

      const act = async (body) => {
        try {
          await post("/api-memory/sessions", { sid, ...body });
          await load();
          setOpen(false);
        } catch (e) {
          setErr(String((e && e.message) || e));
        }
      };

      const entry = info && info.entry;
      const effective = (entry && entry.mode) || (info && info.defaultMode) || "auto";
      const overridden = Boolean(entry && entry.mode);
      const curFlow = entry && entry.recall === false ? "wo" : entry && entry.recall === true ? "on" : "follow";
      const dotColor = effective === "off" ? C.red : overridden ? C.green : C.muted;
      let label = MODE_LABEL[effective] || effective;
      if (entry && entry.recall === false) label += "·只写";

      const chip = h("button", {
        ref: anchorRef,
        onClick: toggle,
        title: !sid ? "发送第一条消息后可设置本会话的记忆档位" : `会话记忆：${label}（点击切换档位/数据流）`,
        style: {
          ...btn, display: "inline-flex", alignItems: "center", gap: "6px",
          padding: "4px 10px", borderRadius: "999px", fontSize: "12px", whiteSpace: "nowrap",
          opacity: !sid ? 0.5 : 1, cursor: !sid ? "default" : "pointer",
          borderColor: overridden || curFlow !== "follow" ? C.brand : C.border,
        },
      },
        h("span", { style: { width: "7px", height: "7px", borderRadius: "50%", background: dotColor, display: "inline-block", flexShrink: 0 } }),
        h("span", null, label),
        h("span", { style: { fontSize: "9px", color: C.muted } }, "▼"),
      );

      const modeRow = (value, labelText, desc) => h("div", {
        key: `m-${value || "global"}`,
        onClick: () => act({ mode: value || null }),
        style: { ...row, padding: "7px 10px", borderRadius: "8px", cursor: "pointer", fontSize: "13px" },
      },
        h("span", { style: { flex: 1 } }, labelText),
        desc ? h("span", { style: { fontSize: "11px", color: C.muted } }, desc) : null,
        (entry && entry.mode || null) === (value || null) ? h("span", { style: { color: C.brand, fontSize: "12px" } }, "✓") : null,
      );
      const flowRow = (value, labelText) => h("div", {
        key: `f-${value}`,
        onClick: () => act({ recall: value === "follow" ? null : value === "on" }),
        style: { ...row, padding: "7px 10px", borderRadius: "8px", cursor: "pointer", fontSize: "13px" },
      },
        h("span", { style: { flex: 1 } }, labelText),
        curFlow === value ? h("span", { style: { color: C.brand, fontSize: "12px" } }, "✓") : null,
      );

      const menu = !open ? null : h("div", {
        ref: menuRef,
        style: {
          position: "fixed", left: pos.left, top: pos.top, width: "248px", zIndex: 9999,
          background: opaqueBackdrop(anchorRef.current), border: `1px solid ${C.border}`, borderRadius: "12px",
          boxShadow: "0 8px 28px rgba(0,0,0,0.22)", padding: "8px", fontSize: "13px",
        },
      },
      h("div", { style: { ...row, padding: "4px 10px 8px", justifyContent: "space-between" } },
        h("strong", { style: { fontSize: "12.5px" } }, "会话记忆"),
        h("span", { style: { fontSize: "11px", color: C.muted } }, `默认档：${MODE_LABEL[info ? info.defaultMode : "auto"] || "auto"}`),
      ),
      h("div", { style: { fontSize: "11px", color: C.muted, padding: "0 10px 4px" } }, "记忆档位"),
      modeRow(null, "跟随全局", "默认档"),
      modeRow("auto", "智能", "双族自动"),
      modeRow("chat", "日常", "个人域"),
      modeRow("work", "工作", "工作域"),
      modeRow("off", "暂停", "完全隐身"),
      h("div", { style: { borderTop: `1px solid ${C.border}`, margin: "6px 4px" } }),
      h("div", { style: { fontSize: "11px", color: C.muted, padding: "0 10px 4px" } }, "数据流（读侧）"),
      flowRow("follow", "跟随全局"),
      flowRow("on", "读写"),
      flowRow("wo", "只写（沉淀但不注入）"),
      err ? h("div", { style: { padding: "4px 10px", fontSize: "11px", color: C.red } }, err) : null,
      );

      return h("div", { style: { display: "inline-flex", position: "relative" } }, chip, menu);
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
        ["overview", "总览"], ["library", "记忆库"], ["bias", "偏差档案"], ["automation", "自动化"], ["insights", "洞察"], ["maintenance", "维护"],
      ];
      return h("div", { style: { minHeight: "300px" } },
        h("div", { style: { display: "flex", gap: "4px", borderBottom: `1px solid ${C.border}`, marginBottom: "14px", position: "sticky", top: 0, zIndex: 2, padding: "6px 0 6px 4px", background: "var(--dsh-card-bg, rgba(127,127,127,0.07))", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", borderRadius: "0 0 10px 10px" } },
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
        tab === "bias" ? h(BiasTab, null) : null,
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
        // 输入栏左簇（权限预设芯片右侧）：会话记忆档位芯片。
        // inject owner 实测为裸 sessionId 字符串（对齐原版 dsh-layered-memory rc.8 行为），
        // 防御性兼容对象形态（{sessionId} / {sid}）。
        ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
          name: "conversation.input.left",
          id: "dsh-memory-mode",
          order: 100,
          inject: (owner) => ({ sessionId: owner }),
        }, MemoryChip));
      } catch (err) {
        console.error("[dsh-memory] client apply failed:", err);
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
