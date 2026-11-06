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

    // ---------- redesign 样式（作用域 .dshm-root，变量 --dshm-*） ----------
    const UI_CSS = `
.dshm-root{
  --dshm-brand-50:#eef0ff; --dshm-brand-100:#e0e3ff; --dshm-brand-300:#a5abff;
  --dshm-brand-500:#5b5bd6; --dshm-brand-600:#4f4fc7; --dshm-brand-700:#4242a8;
  --dshm-bg:#f6f7fb; --dshm-surface:#ffffff; --dshm-surface-2:#fbfbfe; --dshm-surface-3:#f1f2f8;
  --dshm-border:#e6e8f0; --dshm-border-strong:#d4d7e3;
  --dshm-text:#1b1d29; --dshm-text-2:#565a6e; --dshm-text-3:#8a8fa3;
  --dshm-green:#12a150;  --dshm-green-bg:#e6f7ed;
  --dshm-blue:#2f6fed;   --dshm-blue-bg:#e8f0fe;
  --dshm-amber:#d98a00;  --dshm-amber-bg:#fdf2dc;
  --dshm-rose:#e1455b;   --dshm-rose-bg:#fdeaed;
  --dshm-cyan:#0ea5b7;   --dshm-cyan-bg:#e2f6f9;
  --dshm-violet:#7c4dd6; --dshm-violet-bg:#f1e9fc;
  --dshm-sky:#1c8cd6;    --dshm-sky-bg:#e4f3fc;
  --dshm-shadow-sm:0 1px 2px rgba(20,22,40,.06),0 1px 3px rgba(20,22,40,.04);
  --dshm-shadow-md:0 4px 14px rgba(20,22,40,.08);
  --dshm-shadow-lg:0 12px 32px rgba(20,22,40,.12);
  --dshm-r-sm:8px; --dshm-r-md:12px; --dshm-r-lg:16px; --dshm-r-xl:22px;
  --dshm-font:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  --dshm-mono:"JetBrains Mono",ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
  color:var(--dshm-text); font-family:var(--dshm-font); font-size:14px; line-height:1.55;
}
.dshm-root *{ box-sizing:border-box; }
.dshm-root[data-theme="dark"]{
  --dshm-bg:#0e0f1a; --dshm-surface:#161827; --dshm-surface-2:#1b1d2e; --dshm-surface-3:#20233a;
  --dshm-border:#2a2d44; --dshm-border-strong:#383c5a;
  --dshm-text:#eef0f7; --dshm-text-2:#b0b4c9; --dshm-text-3:#7c8198;
  --dshm-brand-50:#1d1f3a; --dshm-brand-100:#262952; --dshm-brand-300:#8b91f0;
  --dshm-brand-500:#7b7bf0; --dshm-brand-600:#6a6ae6;
  --dshm-green:#3ddc84;  --dshm-green-bg:#11331f;
  --dshm-blue:#6aa0ff;   --dshm-blue-bg:#16294d;
  --dshm-amber:#f0b13c;  --dshm-amber-bg:#33280f;
  --dshm-rose:#ff6b81;   --dshm-rose-bg:#3a1620;
  --dshm-cyan:#34c8d8;   --dshm-cyan-bg:#0f2e33;
  --dshm-violet:#b18cf5; --dshm-violet-bg:#281a3d;
  --dshm-sky:#5cb6f0;    --dshm-sky-bg:#102e40;
  --dshm-shadow-sm:0 1px 2px rgba(0,0,0,.4);
  --dshm-shadow-md:0 6px 18px rgba(0,0,0,.45);
  --dshm-shadow-lg:0 16px 40px rgba(0,0,0,.55);
}
.dshm-root .page-head{ display:flex; align-items:flex-end; justify-content:space-between; gap:16px; margin-bottom:22px; flex-wrap:wrap; }
.dshm-root .page-head h1{ font-size:23px; font-weight:700; letter-spacing:-.3px; margin:0; }
.dshm-root .page-head p{ color:var(--dshm-text-2); font-size:13px; margin-top:5px; }
.dshm-root .h-actions{ display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
.dshm-root .mb{ margin-bottom:18px; }
.dshm-root .mt{ margin-top:22px; }
.dshm-root .empty{ text-align:center; color:var(--dshm-text-3); padding:40px; font-size:13px; }
.dshm-root .section-title{ font-size:14px; font-weight:650; margin:4px 0 12px; display:flex; align-items:center; gap:9px; }
.dshm-root .btn{ display:inline-flex; align-items:center; gap:7px; padding:9px 15px; border-radius:10px; font-weight:600; font-size:13px; border:1px solid var(--dshm-border-strong); background:var(--dshm-surface); color:var(--dshm-text); cursor:pointer; transition:.18s; font-family:var(--dshm-font); }
.dshm-root .btn:hover{ background:var(--dshm-surface-3); transform:translateY(-1px); box-shadow:var(--dshm-shadow-sm); }
.dshm-root .btn-primary{ background:var(--dshm-brand-500); color:#fff; border-color:var(--dshm-brand-500); box-shadow:0 4px 12px rgba(91,91,214,.32); }
.dshm-root .btn-primary:hover{ background:var(--dshm-brand-600); }
.dshm-root .btn-danger{ color:var(--dshm-rose); border-color:var(--dshm-rose); background:var(--dshm-rose-bg); }
.dshm-root .btn-danger:hover{ background:var(--dshm-rose); color:#fff; }
.dshm-root .btn-ghost{ border-color:transparent; background:var(--dshm-surface-3); color:var(--dshm-text-2); }
.dshm-root .btn-sm{ padding:6px 11px; font-size:12px; border-radius:8px; }
.dshm-root .btn:disabled{ opacity:.55; cursor:default; transform:none; box-shadow:none; }
.dshm-root .card{ background:var(--dshm-surface); border:1px solid var(--dshm-border); border-radius:var(--dshm-r-lg); box-shadow:var(--dshm-shadow-sm); }
.dshm-root .card-pad{ padding:20px; }
.dshm-root .card-head{ display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid var(--dshm-border); gap:12px; }
.dshm-root .card-head h3{ font-size:15px; font-weight:650; margin:0; }
.dshm-root .card-head .sub{ font-size:12px; color:var(--dshm-text-3); margin-top:2px; }
.dshm-root .grid{ display:grid; gap:18px; }
.dshm-root .grid-5{ grid-template-columns:repeat(5,minmax(0,1fr)); }
.dshm-root .grid-3{ grid-template-columns:repeat(3,minmax(0,1fr)); }
.dshm-root .grid-2{ grid-template-columns:repeat(2,minmax(0,1fr)); }
@media (max-width:1080px){ .dshm-root .grid-5{ grid-template-columns:repeat(3,minmax(0,1fr)); } .dshm-root .grid-3{ grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media (max-width:720px){ .dshm-root .grid-5,.dshm-root .grid-3,.dshm-root .grid-2{ grid-template-columns:minmax(0,1fr); } }
.dshm-root .stat{ padding:18px 20px; }
.dshm-root .stat .label{ font-size:12.5px; color:var(--dshm-text-2); display:flex; align-items:center; gap:7px; }
.dshm-root .stat .value{ font-size:30px; font-weight:750; letter-spacing:-1px; margin-top:8px; line-height:1; }
.dshm-root .stat .value small{ font-size:14px; font-weight:600; color:var(--dshm-text-2); }
.dshm-root .stat .trend{ font-size:12px; margin-top:9px; color:var(--dshm-text-3); }
.dshm-root .stat .trend b{ color:var(--dshm-green); }
.dshm-root .tag{ display:inline-flex; align-items:center; gap:4px; font-size:11px; font-weight:600; padding:2px 9px; border-radius:20px; white-space:nowrap; }
.dshm-root .tag-green{ background:var(--dshm-green-bg); color:var(--dshm-green); }
.dshm-root .tag-blue{ background:var(--dshm-blue-bg); color:var(--dshm-blue); }
.dshm-root .tag-amber{ background:var(--dshm-amber-bg); color:var(--dshm-amber); }
.dshm-root .tag-rose{ background:var(--dshm-rose-bg); color:var(--dshm-rose); }
.dshm-root .tag-cyan{ background:var(--dshm-cyan-bg); color:var(--dshm-cyan); }
.dshm-root .tag-violet{ background:var(--dshm-violet-bg); color:var(--dshm-violet); }
.dshm-root .tag-sky{ background:var(--dshm-sky-bg); color:var(--dshm-sky); }
.dshm-root .tag-outline{ background:transparent; border:1px solid var(--dshm-border-strong); color:var(--dshm-text-2); }
.dshm-root .badge-count{ background:var(--dshm-amber-bg); color:var(--dshm-amber); font-weight:700; padding:4px 12px; border-radius:20px; font-size:12.5px; border:1px solid var(--dshm-amber); white-space:nowrap; }
.dshm-root .hero{ display:flex; align-items:center; gap:18px; padding:22px 24px; flex-wrap:wrap; }
.dshm-root .hero .ok-big{ display:flex; align-items:center; gap:12px; font-weight:700; font-size:17px; }
.dshm-root .hero .ok-big .dot{ width:13px; height:13px; border-radius:50%; background:var(--dshm-green); box-shadow:0 0 0 4px var(--dshm-green-bg); }
.dshm-root .hero .pill-row{ display:flex; gap:8px; flex-wrap:wrap; }
.dshm-root .hero .right{ margin-left:auto; display:flex; align-items:center; gap:16px; }
.dshm-root .hero .meta-line{ font-size:12.5px; color:var(--dshm-text-2); line-height:1.7; }
.dshm-root .hero .meta-line b{ color:var(--dshm-text); font-weight:600; }
.dshm-root .feed{ list-style:none; margin:0; padding:0; }
.dshm-root .feed li,.dshm-root .feed-li{ display:flex; gap:14px; padding:15px 20px; border-bottom:1px solid var(--dshm-border); transition:background .15s; align-items:flex-start; }
.dshm-root .feed li:last-child,.dshm-root .feed-li:last-child{ border-bottom:none; }
.dshm-root .feed li:hover,.dshm-root .feed-li:hover{ background:var(--dshm-surface-2); }
.dshm-root .feed .rail,.dshm-root .feed-li .rail{ width:8px; flex:0 0 auto; display:flex; justify-content:center; padding-top:6px; }
.dshm-root .feed .rail span,.dshm-root .feed-li .rail{ width:8px; height:8px; border-radius:50%; background:var(--dshm-brand-300); }
.dshm-root .feed .body,.dshm-root .feed-li .body{ min-width:0; }
.dshm-root .feed .tags,.dshm-root .feed-li .tags{ display:flex; gap:6px; margin-bottom:5px; flex-wrap:wrap; }
.dshm-root .feed .txt,.dshm-root .feed-li .txt{ font-size:13.5px; color:var(--dshm-text); overflow:hidden; text-overflow:ellipsis; }
.dshm-root .feed .txt .more,.dshm-root .feed-li .txt .more{ color:var(--dshm-text-3); }
.dshm-root .feed .time,.dshm-root .feed-li .time{ font-size:12px; color:var(--dshm-text-3); white-space:nowrap; flex:0 0 auto; }
.dshm-root .toolbar{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:16px; }
.dshm-root .seg{ display:inline-flex; background:var(--dshm-surface-3); border-radius:10px; padding:3px; gap:2px; }
.dshm-root .seg button{ border:none; background:none; padding:6px 13px; border-radius:8px; font-size:12.5px; font-weight:600; color:var(--dshm-text-2); cursor:pointer; font-family:var(--dshm-font); transition:.15s; }
.dshm-root .seg button.on{ background:var(--dshm-surface); color:var(--dshm-text); box-shadow:var(--dshm-shadow-sm); }
.dshm-root .filter-input{ display:flex; align-items:center; gap:8px; background:var(--dshm-surface); border:1px solid var(--dshm-border); border-radius:10px; padding:8px 12px; width:260px; }
.dshm-root .filter-input input{ border:none; background:none; outline:none; color:var(--dshm-text); font-family:var(--dshm-font); font-size:13px; width:100%; }
.dshm-root .rows{ display:flex; flex-direction:column; }
.dshm-root .row{ display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:14px; padding:14px 20px; border-bottom:1px solid var(--dshm-border); transition:background .15s; }
.dshm-root .row:hover{ background:var(--dshm-surface-2); }
.dshm-root .row:last-child{ border-bottom:none; }
.dshm-root .row .r-main{ min-width:0; }
.dshm-root .row .r-title{ font-weight:600; font-size:13.5px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.dshm-root .row .r-sub{ font-size:12.5px; color:var(--dshm-text-2); margin-top:4px; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
.dshm-root .row .r-meta{ display:flex; flex-direction:column; align-items:flex-end; gap:4px; white-space:nowrap; }
.dshm-root .row .r-meta .k{ font-size:11px; color:var(--dshm-text-3); }
.dshm-root .row .r-meta .v{ font-size:12.5px; font-weight:600; }
.dshm-root .id-chip{ font-family:var(--dshm-mono); font-size:11.5px; background:var(--dshm-surface-3); color:var(--dshm-text-2); padding:2px 8px; border-radius:6px; }
.dshm-root .toggle-row{ display:flex; align-items:flex-start; gap:16px; padding:16px 20px; border-bottom:1px solid var(--dshm-border); }
.dshm-root .toggle-row:last-child{ border-bottom:none; }
.dshm-root .toggle-row .tr-body{ flex:1; min-width:0; }
.dshm-root .toggle-row .tr-title{ font-weight:600; font-size:14px; display:flex; align-items:center; gap:8px; }
.dshm-root .toggle-row .tr-desc{ font-size:12.5px; color:var(--dshm-text-2); margin-top:4px; }
.dshm-root .switch{ position:relative; width:44px; height:26px; flex:0 0 auto; margin-top:2px; }
.dshm-root .switch input{ opacity:0; width:0; height:0; position:absolute; }
.dshm-root .switch-input{ opacity:0; width:0; height:0; position:absolute; }
.dshm-root .switch .slider{ position:absolute; inset:0; background:var(--dshm-border-strong); border-radius:20px; transition:.22s; cursor:pointer; }
.dshm-root .switch .slider::before{ content:""; position:absolute; width:20px; height:20px; left:3px; top:3px; background:#fff; border-radius:50%; transition:.22s; box-shadow:var(--dshm-shadow-sm); }
.dshm-root .switch input:checked + .slider{ background:var(--dshm-brand-500); }
.dshm-root .switch input:checked + .slider::before{ transform:translateX(18px); }
.dshm-root .switch-input:checked + .switch .slider{ background:var(--dshm-brand-500); }
.dshm-root .switch-input:checked + .switch .slider::before{ transform:translateX(18px); }
.dshm-root .spacer{ flex:1; }
.dshm-root select.inp{ appearance:none; background:var(--dshm-surface); border:1px solid var(--dshm-border); border-radius:10px; padding:10px 14px; font-size:13px; color:var(--dshm-text); font-family:var(--dshm-font); cursor:pointer; min-width:200px; }
.dshm-root select.inp:focus{ outline:none; border-color:var(--dshm-brand-300); box-shadow:0 0 0 3px var(--dshm-brand-50); }
.dshm-root .rtable{ width:100%; border-collapse:collapse; font-size:13px; }
.dshm-root .rtable th{ text-align:left; font-size:11.5px; color:var(--dshm-text-3); font-weight:600; padding:12px 20px; border-bottom:1px solid var(--dshm-border); text-transform:uppercase; letter-spacing:.5px; }
.dshm-root .rtable td{ padding:14px 20px; border-bottom:1px solid var(--dshm-border); vertical-align:middle; }
.dshm-root .rtable tr:last-child td{ border-bottom:none; }
.dshm-root .rtable .cond{ font-family:var(--dshm-mono); font-size:12px; color:var(--dshm-text-2); }
.dshm-root .rtable td.fail{ color:var(--dshm-rose); font-weight:600; }
.dshm-root .rtable tr.sub td{ background:var(--dshm-surface-2); color:var(--dshm-text-2); font-size:12px; }
.dshm-root .rtable tr.err td{ color:var(--dshm-rose); font-size:12px; font-family:var(--dshm-mono); }
.dshm-root .danger{ border-color:var(--dshm-rose); background:var(--dshm-rose-bg); }
.dshm-root .danger .card-head{ border-bottom-color:var(--dshm-rose); }
.dshm-root .danger .card-head h3{ color:var(--dshm-rose); }
.dshm-root .note{ font-size:12.5px; color:var(--dshm-text-2); margin-top:10px; line-height:1.7; }
.dshm-root .mono{ font-family:var(--dshm-mono); font-size:12px; }
.dshm-root .logline{ font-family:var(--dshm-mono); font-size:12.5px; padding:10px 16px; border-bottom:1px solid var(--dshm-border); color:var(--dshm-text-2); }
.dshm-root .logline:last-child{ border-bottom:none; }
.dshm-root .logline .lv{ color:var(--dshm-sky); font-weight:600; }
.dshm-root .kv{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px 24px; margin-top:6px; }
.dshm-root .kv .item,.dshm-root .kv-item{ display:flex; justify-content:space-between; gap:12px; padding:9px 0; border-bottom:1px dashed var(--dshm-border); font-size:13px; }
.dshm-root .kv .item span,.dshm-root .kv-item .k{ color:var(--dshm-text-3); }
.dshm-root .kv .item b,.dshm-root .kv-item .v{ font-weight:600; color:var(--dshm-text); }
.dshm-root .pill-list{ display:flex; flex-wrap:wrap; gap:7px; margin-top:12px; }
.dshm-root .pill-list .pill{ font-family:var(--dshm-mono); font-size:11.5px; background:var(--dshm-surface-3); color:var(--dshm-text-2); padding:4px 10px; border-radius:7px; }
.dshm-root .flash{ border-left:3px solid var(--dshm-brand-500); }
.dshm-root .flash-rose{ border-left-color:var(--dshm-rose); }
.dshm-root .flash-amber{ border-left-color:var(--dshm-amber); }
.dshm-root .mod-toolbar{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:18px; }
.dshm-root .tool-btn{ display:inline-flex; align-items:center; gap:7px; padding:8px 14px; border-radius:9px; font-size:12.5px; font-weight:600; border:1px solid var(--dshm-border); background:var(--dshm-surface-2); color:var(--dshm-text-2); cursor:pointer; transition:.18s; font-family:var(--dshm-font); }
.dshm-root .tool-btn:hover{ background:var(--dshm-surface-3); color:var(--dshm-text); }
.dshm-root .field{ display:flex; align-items:center; justify-content:space-between; gap:16px; padding:11px 0; border-bottom:1px dashed var(--dshm-border); }
.dshm-root .field:last-child{ border-bottom:none; }
.dshm-root .field > label{ font-size:13px; color:var(--dshm-text-2); flex:0 0 auto; }
.dshm-root .field .ctl{ display:flex; align-items:center; gap:10px; flex:0 0 auto; }
.dshm-root .inp-text{ border:1px solid var(--dshm-border); border-radius:8px; padding:8px 12px; font-size:13px; background:var(--dshm-surface); color:var(--dshm-text); font-family:var(--dshm-font); width:240px; transition:.18s; }
.dshm-root .inp-text.sm{ width:110px; }
.dshm-root .inp-text.mono{ font-family:var(--dshm-mono); }
.dshm-root .inp-text:focus{ outline:none; border-color:var(--dshm-brand-300); box-shadow:0 0 0 3px var(--dshm-brand-50); }
.dshm-root .textarea{ width:100%; min-height:84px; border:1px solid var(--dshm-border); border-radius:10px; padding:12px 14px; font-family:var(--dshm-mono); font-size:12.5px; line-height:1.6; background:var(--dshm-surface); color:var(--dshm-text); resize:vertical; transition:.18s; }
.dshm-root .textarea:focus{ outline:none; border-color:var(--dshm-brand-300); box-shadow:0 0 0 3px var(--dshm-brand-50); }
.dshm-root .field-label{ font-size:12.5px; font-weight:600; color:var(--dshm-text); margin:16px 0 7px; }
.dshm-root .field-label:first-child{ margin-top:0; }
.dshm-root .form-grid{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:0 28px; }
@media (max-width:720px){ .dshm-root .form-grid{ grid-template-columns:minmax(0,1fr); } }
.dshm-root .chip-head{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.dshm-root .chip-id{ font-family:var(--dshm-mono); font-size:12px; color:var(--dshm-text-2); background:var(--dshm-surface-3); padding:3px 10px; border-radius:7px; }
.dshm-root .chain-block{ margin-top:14px; }
.dshm-root .chart-wrap{ width:100%; }
.dshm-root .chart-wrap svg{ width:100%; height:auto; display:block; }
.dshm-root .chart-grid{ stroke:var(--dshm-border); stroke-width:1; }
.dshm-root .chart-axis{ fill:var(--dshm-text-3); font-size:12px; font-family:var(--dshm-font); }
.dshm-root .legend{ display:flex; gap:18px; flex-wrap:wrap; margin-top:12px; font-size:12.5px; color:var(--dshm-text-2); }
.dshm-root .legend .lg{ display:flex; align-items:center; gap:7px; }
.dshm-root .legend .sw{ width:14px; height:4px; border-radius:3px; }
.dshm-root .metric-row{ display:flex; gap:28px; flex-wrap:wrap; margin-top:14px; }
.dshm-root .metric-row .m{ display:flex; flex-direction:column; gap:3px; }
.dshm-root .metric-row .m .k{ font-size:12px; color:var(--dshm-text-3); }
.dshm-root .metric-row .m .v{ font-size:18px; font-weight:700; }
.dshm-root .tabs{ display:flex; gap:4px; border-bottom:1px solid var(--dshm-border); margin-bottom:22px; overflow-x:auto; }
.dshm-root .nav-item{ display:inline-flex; align-items:center; gap:8px; padding:14px 16px; font-size:14.5px; font-weight:600; color:var(--dshm-text-2); border:none; background:none; cursor:pointer; border-bottom:2px solid transparent; white-space:nowrap; font-family:var(--dshm-font); transition:.15s; }
.dshm-root .nav-item:hover{ color:var(--dshm-text); }
.dshm-root .nav-item.on{ color:var(--dshm-brand-700); border-bottom-color:var(--dshm-brand-500); }
.dshm-root .nav-item svg{ width:17px; height:17px; flex:0 0 auto; }
.dshm-root .nav-count{ font-size:11px; font-weight:700; background:var(--dshm-surface-3); color:var(--dshm-text-2); padding:1px 7px; border-radius:20px; }
.dshm-root .row-inline{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.dshm-root .view-pad{ padding:22px 4px; }
.dshm-root .row-detail{ padding:12px 20px 16px; border-bottom:1px solid var(--dshm-border); background:var(--dshm-surface-2); font-size:12.5px; line-height:1.65; }
.dshm-root .row-detail:last-child{ border-bottom:none; }
.dshm-root .dshm-text{ white-space:pre-wrap; word-break:break-word; color:var(--dshm-text); }
.dshm-root .dshm-busy-icon{ font-weight:700; margin-right:6px; }
.dshm-root .dshm-msg-icon{ font-weight:700; margin-right:6px; }
.chip-menu{ position:fixed; width:248px; z-index:9999; background:var(--dshm-surface); border:1px solid var(--dshm-border); border-radius:12px; box-shadow:var(--dshm-shadow-lg); padding:8px; font-size:13px; }
.chip-menu .mi{ display:flex; align-items:center; gap:8px; padding:7px 10px; border-radius:8px; cursor:pointer; font-size:13px; }
.chip-menu .mi:hover{ background:var(--dshm-surface-3); }
.chip-menu .mi .sp{ flex:1; }
.chip-menu .mi .desc{ font-size:11px; color:var(--dshm-text-3); }
.chip-menu .mi .ok{ color:var(--dshm-brand-500); font-size:12px; }
.chip-menu .sep{ border-top:1px solid var(--dshm-border); margin:6px 4px; }
.chip-menu .mhead{ display:flex; align-items:center; justify-content:space-between; padding:4px 10px 8px; }
.chip-menu .mlabel{ font-size:11px; color:var(--dshm-text-3); padding:0 10px 4px; }
.chip-menu .merr{ padding:4px 10px; font-size:11px; color:var(--dshm-rose); }

.chip-pill, .chip-menu{
  --dshm-brand-50:#eef0ff; --dshm-brand-100:#e0e3ff; --dshm-brand-300:#a5abff; --dshm-brand-500:#5b5bd6; --dshm-brand-600:#4f4fc7; --dshm-brand-700:#4242a8; --dshm-surface:#ffffff; --dshm-surface-2:#fbfbfe; --dshm-surface-3:#f1f2f8; --dshm-border:#e6e8f0; --dshm-border-strong:#d4d7e3; --dshm-text:#1b1d29; --dshm-text-2:#565a6e; --dshm-text-3:#8a8fa3; --dshm-green:#12a150; --dshm-green-bg:#e6f7ed; --dshm-blue:#2f6fed; --dshm-blue-bg:#e8f0fe; --dshm-amber:#d98a00; --dshm-amber-bg:#fdf2dc; --dshm-rose:#e1455b; --dshm-rose-bg:#fdeaed; --dshm-cyan:#0ea5b7; --dshm-cyan-bg:#e2f6f9; --dshm-violet:#7c4dd6; --dshm-violet-bg:#f1e9fc; --dshm-sky:#1c8cd6; --dshm-sky-bg:#e4f3fc; --dshm-shadow-sm:0 1px 2px rgba(20,22,40,.06),0 1px 3px rgba(20,22,40,.04); --dshm-shadow-md:0 4px 14px rgba(20,22,40,.08); --dshm-shadow-lg:0 12px 32px rgba(20,22,40,.12); --dshm-r-sm:8px; --dshm-r-md:12px; --dshm-r-lg:16px; --dshm-r-xl:22px; --dshm-font:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; --dshm-mono:"JetBrains Mono",ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
}
@media (prefers-color-scheme: dark){ .chip-pill, .chip-menu{ --dshm-surface:#161827; --dshm-surface-2:#1b1d2e; --dshm-surface-3:#20233a; --dshm-border:#2a2d44; --dshm-border-strong:#383c5a; --dshm-text:#eef0f7; --dshm-text-2:#b0b4c9; --dshm-text-3:#7c8198; --dshm-brand-50:#1d1f3a; --dshm-brand-100:#262952; --dshm-brand-300:#8b91f0; --dshm-brand-500:#7b7bf0; --dshm-brand-600:#6a6ae6; --dshm-green:#3ddc84; --dshm-green-bg:#11331f; --dshm-blue:#6aa0ff; --dshm-blue-bg:#16294d; --dshm-amber:#f0b13c; --dshm-amber-bg:#33280f; --dshm-rose:#ff6b81; --dshm-rose-bg:#3a1620; --dshm-cyan:#34c8d8; --dshm-cyan-bg:#0f2e33; --dshm-violet:#b18cf5; --dshm-violet-bg:#281a3d; --dshm-sky:#5cb6f0; --dshm-sky-bg:#102e40; --dshm-shadow-sm:0 1px 2px rgba(0,0,0,.4); --dshm-shadow-md:0 6px 18px rgba(0,0,0,.45); --dshm-shadow-lg:0 16px 40px rgba(0,0,0,.55); } }
.chip-pill{ display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:999px; font-size:12px; white-space:nowrap; border:1px solid var(--dshm-border); background:var(--dshm-surface); cursor:pointer; color:var(--dshm-text); font-family:var(--dshm-font); }
.chip-pill:disabled{ opacity:.5; cursor:default; }
.chip-disabled{ opacity:.5; cursor:default; }
.chip-dot{ width:7px; height:7px; border-radius:50%; display:inline-block; flex-shrink:0; }
.dshm-root .dshm-note{ font-size:12.5px; color:var(--dshm-text-2); line-height:1.7; }
.dshm-root .dshm-msg{ margin-top:10px; padding:9px 12px; border-radius:8px; font-size:12.5px; line-height:1.55; }
.dshm-root .dshm-msg.ok{ border:1px solid var(--dshm-green); background:var(--dshm-green-bg); color:var(--dshm-green); }
.dshm-root .dshm-msg.warn{ border:1px solid var(--dshm-amber); background:var(--dshm-amber-bg); color:var(--dshm-amber); }
.dshm-root .dshm-msg.err{ border:1px solid var(--dshm-rose); background:var(--dshm-rose-bg); color:var(--dshm-rose); }
.dshm-root .dshm-busy{ margin-top:10px; padding:9px 12px; border-radius:8px; border:1px solid #93b8e8; background:rgba(59,130,246,0.10); font-size:12.5px; line-height:1.55; color:#1e4e8c; }
.dshm-root .dshm-progress{ height:6px; border-radius:3px; background:var(--dshm-border); overflow:hidden; }
.dshm-root .dshm-progress > div{ height:100%; background:var(--dshm-brand-500); transition:width .3s ease; }
.dshm-root .dshm-logbox{ max-height:260px; overflow:auto; font-size:11.5px; font-family:var(--dshm-mono); color:var(--dshm-text-2); white-space:pre-wrap; word-break:break-all; }
`;
    /*__UI_CSS_END__*/

    // ---------- 样式基元（redesign className 版） ----------
    const cx = (...names) => names.filter(Boolean).join(" ");
    const C = {
      brand: "var(--dshm-brand-500, #6f83ff)",
      green: "var(--dshm-green, #16a34a)",
      amber: "var(--dshm-amber, #d97706)",
      red: "var(--dshm-rose, #dc2626)",
      purple: "var(--dshm-violet, #a855f7)",
      muted: "var(--dshm-text-3, var(--dsh-text-muted, #6b7280))",
      border: "var(--dshm-border, var(--dsh-border, rgba(127,127,127,0.25)))",
      card: "var(--dshm-surface-3, var(--dsh-card-bg, rgba(127,127,127,0.07)))",
    };
    const card = "card";
    const row = "row-inline";
    const btn = "btn";
    const btnPrimary = "btn btn-primary";
    const btnDanger = "btn btn-danger";
    const input = "inp-text";
    const tag = (cls, text) => h("span", { className: cx("tag", cls || "tag-outline") }, text);
    const LAYER_LABEL = { memory: "记忆", scene: "场景", persona: "画像" };
    const LAYER_CLASS = { memory: "tag-blue", scene: "tag-green", persona: "tag-violet" };
    const VERB_LABEL = { added: "新增", updated: "更新", merged: "合并", deleted: "删除" };
    const VERB_CLASS = { added: "tag-green", updated: "tag-blue", merged: "tag-cyan", deleted: "tag-rose" };
    const FAMILY_LABEL = { chat: "个人", work: "工作" };
    const FAMILY_CLASS = { chat: "tag-blue", work: "tag-amber" };
    // 记忆类型（L1 记录的 kind）：fact 不显示徽标，只有非事实才标注，避免每条都挂标签
    const KIND_LABEL = { opinion: "我的判断", commitment: "待收束" };
    const KIND_CLASS = { opinion: "tag-violet", commitment: "tag-rose" };
    const KIND_TITLE = { opinion: "助手的主观判断或推测，未获用户确认，不可当事实使用", commitment: "尚未收束的事：待办、待排查、待拍板或进行中" };
    const MODE_LABEL = { auto: "智能", chat: "日常", work: "工作", off: "暂停" };
    const MODE_CLASS = { auto: "tag-blue", chat: "tag-cyan", work: "tag-amber", off: "tag-rose" };

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
      if (!data) return h("div", { className: "empty" }, "加载中…");
      const { counts, stats, activity, pendingDistill, rebuild, families, sessionModes } = data;
      const healthy = !props.lastError;
      const chatRec = (families && families.chat && families.chat.records) || 0;
      const workRec = (families && families.work && families.work.records) || 0;
      const hasAny = counts.records + counts.scenes > 0 || counts.hasPersona;
      return h("div", { className: "view-pad" },
        h("div", { className: "page-head" },
          h("div", null,
            h("h1", null, "记忆总览"),
            h("p", null, "运行状态、资产规模与最近活动一览"),
          ),
        ),
        // hero 状态卡
        h("div", { className: "card card-pad" },
          h("div", { className: "hero" },
            h("div", { className: "ok-big" },
              h("span", { className: cx("dot", healthy ? "dot-green" : "dot-amber") }),
              h("b", null, healthy ? "运行正常" : "有告警"),
            ),
            h("div", { className: "pill-row" },
              tag("tag-blue", "存储"),
              tag(hasAny ? "tag-green" : "tag-outline", "检索"),
              tag(stats.lastDistillAt ? "tag-green" : "tag-outline", "蒸馏队列"),
            ),
            pendingDistill > 0 ? h("span", { className: "badge-count" }, `待蒸馏 ${pendingDistill} 条`) : null,
            h("div", { className: "right meta-line" },
              h("b", null, String(counts.records)), " 记忆 · ",
              h("b", null, String(counts.scenes)), " 场景 · ",
              h("b", null, String(counts.conversations)), " 会话",
            ),
          ),
          sessionModes && (sessionModes.off > 0 || sessionModes.wo > 0) ? h("div", { className: "note mt" },
            `会话停用分布：暂停 ${sessionModes.off} · 只写 ${sessionModes.wo}`) : null,
          props.lastError ? h("div", { className: "flash flash-amber mt" }, `最近告警：${props.lastError.message}`) : null,
          rebuild && rebuild.phase === "running" ? h("div", { className: "flash mt" },
            `全量重建进行中：${rebuild.done}/${rebuild.total}`) : null,
        ),
        // 关键数字瓦片
        h("div", { className: "grid grid-5" },
          stat("记忆资产", String(counts.records), `${chatRec} 个人 · ${workRec} 工作`),
          stat("场景", String(counts.scenes), "L2 场景块"),
          stat("偏差档案", String(counts.biases || 0), "判错修正"),
          stat("本周蒸馏输出", fmtTokens(data.outputTokens7d), "LLM tokens"),
          stat("上次蒸馏", relTime(stats.lastDistillAt), "距现在"),
        ),
        // 最近活动
        h("div", { className: "card card-pad" },
          h("div", { className: "card-head" },
            h("h3", null, "最近活动"),
            h("span", { className: "sub" }, "最新的记忆写入与更新"),
          ),
          activity.length === 0
            ? h("div", { className: "empty" }, "还没有记忆活动。正常使用几轮对话后，第一批原子记忆会自动沉淀到这里。")
            : h("div", { className: "feed" }, activity.slice(0, 12).map((a, i) => h("div", { key: i, className: "feed-li" },
                h("span", { className: "rail" }),
                h("div", { className: "tags" },
                  tag(VERB_CLASS[a.verb] || "tag-outline", VERB_LABEL[a.verb] || a.verb),
                  tag(LAYER_CLASS[a.layer] || "tag-outline", LAYER_LABEL[a.layer] || a.layer),
                  a.family ? tag(FAMILY_CLASS[a.family] || "tag-outline", FAMILY_LABEL[a.family] || a.family) : null,
                ),
                h("div", { className: "txt" }, a.title),
                h("div", { className: "time" }, relTime(a.ts)),
              ))),
        ),
      );
    }

    function stat(label, value, trend) {
      return h("div", { className: "card stat" },
        h("div", { className: "label" }, label),
        h("div", { className: "value" }, value),
        trend ? h("div", { className: "trend" }, trend) : null,
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
      // redesign：全部/个人/工作 用分段按钮，资产类型/搜索用下拉+输入
      return h("div", { className: "view-pad" },
        h("div", { className: "page-head" },
          h("div", null,
            h("h1", null, "记忆库"),
            h("p", null, "浏览 L1 记忆、L2 场景与 L3 画像，支持按分域与关键词过滤"),
          ),
        ),
        h("div", { className: "toolbar" },
          h("div", { className: "seg" },
            [["all", "全部"], ["chat", "个人"], ["work", "工作"]].map(([v, l]) =>
              h("button", { key: v, className: cx("seg-btn", family === v && "on"), onClick: () => setFamily(v) }, l)),
          ),
          h("select", { className: "select inp", value: type, onChange: (e) => setType(e.target.value) },
            h("option", { value: "all" }, "全部资产"),
            h("option", { value: "memory" }, "L1 记忆"),
            h("option", { value: "scene" }, "L2 场景"),
            h("option", { value: "persona" }, "L3 画像"),
          ),
          h("input", { className: "filter-input", placeholder: "搜索内容…", value: q, onChange: (e) => setQ(e.target.value) }),
          h("span", { className: "spacer" }),
          h("button", { className: btn, onClick: load }, "刷新"),
        ),
        items === null ? h("div", { className: "empty" }, "加载中…")
          : items.length === 0 ? h("div", { className: "empty" }, "没有匹配的记忆资产。")
          : h("div", { className: "rows" }, items.map((item) => h("div", { key: item.kind + item.id, className: cx("card card-pad", openId === item.id && "row-open") },
            h("div", { className: "row", onClick: () => setOpenId(openId === item.id ? null : item.id) },
              tag(LAYER_CLASS[item.kind] || "tag-outline", LAYER_LABEL[item.kind] || item.kind),
              item.family ? tag(FAMILY_CLASS[item.family] || "tag-outline", FAMILY_LABEL[item.family] || item.family) : null,
              item.kind === "memory" && item.memKind && item.memKind !== "fact"
                ? h("span", { title: KIND_TITLE[item.memKind] || "" }, tag(KIND_CLASS[item.memKind] || "tag-outline", KIND_LABEL[item.memKind] || item.memKind))
                : null,
              h("span", { className: "r-title" },
                item.kind === "memory" ? item.content.slice(0, 90) : item.title),
              item.kind === "memory" ? h("span", { className: "id-chip" }, item.id.slice(0, 8)) : null,
              h("span", { className: "r-meta" },
                h("span", { className: "k" }, "更新"),
                h("span", { className: "v" }, relTime(item.updatedAt)),
              ),
            ),
            openId === item.id ? h("div", { className: "row-detail" },
              h("div", { className: "dshm-text" }, item.content),
              h("div", { className: "row-inline" },
                item.tags && item.tags.length > 0 ? h("span", { className: "note" }, "标签: " + item.tags.join("、")) : null,
                item.kind === "memory" && item.hits != null ? h("span", { className: "note" }, `召回 ${item.hits} 次`) : null,
                item.kind === "scene" ? h("span", { className: "note" }, `涵盖 ${item.recordCount} 条记忆`) : null,
                h("span", { className: "spacer" }),
                h("button", { className: btn, onClick: () => navigator.clipboard && navigator.clipboard.writeText(item.content) }, "复制"),
                item.kind === "memory" ? h("button", {
                  className: btnDanger,
                  onClick: async () => { await post("/api-memory/records/delete", { id: item.id }); load(); },
                }, "删除") : null,
              ),
            ) : null,
          ))),
      );
    }

    // ---------- 偏差档案 ----------
    const BIAS_KIND_LABEL = { judgment: "判断错", "recall-miss": "该召没召", "recall-noise": "召来噪音", route: "路由错" };
    const BIAS_KIND_CLASS = { judgment: "tag-rose", "recall-miss": "tag-amber", "recall-noise": "tag-amber", route: "tag-violet" };
    const BIAS_STATUS_LABEL = { pending: "待复核", confirmed: "已确认" };
    const BIAS_STATUS_CLASS = { pending: "tag-amber", confirmed: "tag-green" };
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
      const field = (key, label, placeholder) => h("div", { className: "field" },
        h("div", { className: "field-label" }, label),
        h("input", { className: "inp-text", placeholder, value: form[key] || "", onChange: (e) => setForm({ ...form, [key]: e.target.value }) }),
      );
      return h("div", { className: "view-pad" },
        h("div", { className: "page-head" },
          h("div", null,
            h("h1", null, "偏差档案"),
            h("p", null, "模型判错时的场景与修正，召回命中时自动注入"),
          ),
          h("div", { className: "h-actions" },
            h("button", { className: btn, onClick: () => setForm(form ? null : { ...EMPTY_BIAS }) }, form ? "取消" : "新建偏差"),
          ),
        ),
        h("div", { className: "toolbar" },
          h("div", { className: "seg" },
            [["all", "全部"], ["chat", "个人"], ["work", "工作"]].map(([v, l]) =>
              h("button", { key: v, className: cx("seg-btn", family === v && "on"), onClick: () => setFamily(v) }, l)),
          ),
          h("span", { className: "note" }, "召回时只有话题撞上才注入对应偏差（阈值 0.45，最多 1 条）；与 L1 记忆共用同一套去重"),
        ),
        msg ? h("div", { className: "note mt" }, msg) : null,
        form ? h("div", { className: "card card-pad" },
          h("div", { className: "card-head" },
            h("h3", null, "手动入档"),
            h("span", { className: "sub" }, "记录一次判断失误的场景与修正"),
          ),
          field("scene", "场景（什么情境）", "例如：dsh-memory 存量改盘"),
          field("deviation", "偏差（错在哪）", "例如：以为重启够快就不会被覆盖"),
          field("rootCause", "根因（为什么错）", "例如：写盘用的是插件内存里的旧值"),
          field("fix", "修正（下次怎么做）", "例如：先在 config overlay 关掉 extract.enabled 再落盘"),
          h("div", { className: "row-inline mt" },
            h("select", { className: "select inp", value: form.family, onChange: (e) => setForm({ ...form, family: e.target.value }) },
              h("option", { value: "chat" }, "个人"),
              h("option", { value: "work" }, "工作"),
            ),
            h("select", { className: "select inp", value: form.kind, onChange: (e) => setForm({ ...form, kind: e.target.value }) },
              h("option", { value: "judgment" }, "判断错"),
              h("option", { value: "recall-miss" }, "该召没召"),
              h("option", { value: "recall-noise" }, "召来噪音"),
              h("option", { value: "route" }, "路由错"),
            ),
            h("span", { className: "spacer" }),
            h("button", { className: btnPrimary, onClick: save }, "保存"),
          ),
        ) : null,
        data === null ? h("div", { className: "empty" }, "加载中…")
          : data.biases.length === 0 ? h("div", { className: "empty" }, "还没有偏差档案。模型可在出错当场用 memory_bias 入档，这里也能手动补。")
          : h("div", { className: "rows" }, data.biases.map((b) => h("div", { key: b.id, className: "card card-pad flash flash-rose" },
            h("div", { className: "row" },
              h("span", { className: "id-chip" }, `B-${b.no}`),
              tag(BIAS_KIND_CLASS[b.kind] || "tag-outline", BIAS_KIND_LABEL[b.kind] || b.kind),
              tag(FAMILY_CLASS[b.family] || "tag-outline", FAMILY_LABEL[b.family] || b.family),
              b.status ? tag(BIAS_STATUS_CLASS[b.status] || "tag-outline", BIAS_STATUS_LABEL[b.status] || b.status) : null,
              h("span", { className: "r-title" }, b.deviation),
              h("span", { className: "r-meta" },
                h("span", { className: "k" }, "日期"),
                h("span", { className: "v" }, b.date || "—"),
              ),
              h("button", { className: btnDanger, onClick: async () => { await post("/api-memory/biases", { action: "delete", id: b.id }); load(); } }, "删除"),
            ),
            h("div", { className: "row-detail" },
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
      const MODE_CLASS = { auto: "tag-blue", chat: "tag-cyan", work: "tag-amber", off: "tag-rose" };
      return h("div", { className: "card card-pad" },
        h("div", { className: "card-head" },
          h("h3", null, "会话记忆模式"),
          h("span", { className: "sub" }, "新会话默认档 · " + (data ? MODE_LABEL[data.defaultMode] || data.defaultMode : "…")),
          h("button", { className: "btn btn-sm", onClick: load }, "刷新"),
        ),
        h("div", { className: "note" },
          "智能=双族自动归档；日常=只进个人域；工作=只进工作域；暂停=本会话对记忆系统隐身（不捕获不注入）。数据流「只写」照常沉淀记忆但不在本会话注入。"),
        !data ? h("div", { className: "empty" }, "加载中…")
          : sessions.length === 0 ? h("div", { className: "empty", style: { padding: "8px 0" } }, "暂无活跃会话。")
          : h("div", null, sessions.slice(0, 20).map((s, i) => h("div", {
              key: s.sid, className: cx("row", i < Math.min(sessions.length, 20) - 1 && "row-line"), style: { flexWrap: "wrap" },
            },
              h("span", { className: "chip-id" }, s.sid.slice(0, 14) + (s.sid.length > 14 ? "…" : "")),
              tag(MODE_CLASS[s.effectiveMode] || "tag-outline", MODE_LABEL[s.effectiveMode] || s.effectiveMode),
              s.recall === false ? tag("tag-amber", "只写") : null,
              s.mode === "off" ? tag("tag-rose", "已暂停") : null,
              s.count > 0 ? tag("tag-amber", `待蒸馏 ${s.count}`) : null,
              h("span", { className: "spacer" }),
              h("select", { className: "select inp", value: s.mode || "", onChange: (e) => setMode(s.sid, e.target.value) },
                h("option", { value: "" }, `跟随全局（${MODE_LABEL[data.defaultMode]}）`),
                h("option", { value: "auto" }, "智能"),
                h("option", { value: "chat" }, "日常"),
                h("option", { value: "work" }, "工作"),
                h("option", { value: "off" }, "暂停"),
              ),
              h("select", { className: "select inp", value: s.recall === false ? "wo" : s.recall === true ? "on" : "follow", onChange: (e) => setFlow(s.sid, e.target.value) },
                h("option", { value: "follow" }, "数据流：跟随全局"),
                h("option", { value: "on" }, "读写"),
                h("option", { value: "wo" }, "只写"),
              ),
            ))),
        msg ? h("div", { className: "note mt", style: { color: C.green } }, msg) : null,
      );
    }

    function RouteChainCard({ cfg, setCfg }) {
      const fallbacksText = chainToText(getIn(cfg, "llm.fallbacks"));
      const layerText = (key) => chainToText(getIn(cfg, `llm.layerRoutes.${key}`));
      const update = (path, text) => setCfg((prev) => setIn(prev, path, textToChain(text)));
      const area = { minHeight: "54px", resize: "none" };
      return h("div", { className: "card card-pad" },
        h("div", { className: "card-head" },
          h("h3", null, "蒸馏路由链"),
          h("span", { className: "sub" }, "主路由失败时按序自动降级，每条路由各享全额蒸馏超时"),
        ),
        h("div", { className: "note" }, "每行一条：provider|model[|思考档]，如 opencode-go|deepseek-v4-flash|low"),
        h("div", { className: "chain-block" },
          h("div", { className: "field-label" }, "全局回退链（主路由之后依次尝试）"),
          h("textarea", { className: "textarea", style: area, value: fallbacksText, placeholder: "provider|model[|effort]，每行一条", onChange: (e) => update("llm.fallbacks", e.target.value) }),
        ),
        ["l1", "l2", "l3"].map((key) => h("div", { key, className: "chain-block" },
          h("div", { className: "field-label" }, `${key.toUpperCase()} 独立链（留空跟随全局）`),
          h("textarea", { className: "textarea", style: { ...area, minHeight: "44px" }, value: layerText(key), placeholder: "头行必须 provider|model", onChange: (e) => update(`llm.layerRoutes.${key}`, e.target.value) }),
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
      const f = (path, label, placeholder, type) => h("div", { key: path, className: "field" },
        h("div", { className: "field-label" }, label),
        h("input", { className: "inp-text", type: type || "text", placeholder: placeholder || "", value: getIn(cfg, path) ?? "", onChange: (e) => setCfg((prev) => setIn(prev, path, type === "number" ? Number(e.target.value) : e.target.value)) }),
      );
      return h("div", { className: "card card-pad" },
        h("div", { className: "card-head" },
          h("h3", null, "语义检索（嵌入源）"),
          status ? tag(status.ready ? "tag-green" : status.enabled ? "tag-amber" : "tag-outline", status.ready ? "已索引" : status.enabled ? "源已切换" : "关闭") : null,
        ),
        h("div", { className: "note" },
          "OpenAI 兼容 /embeddings 服务（如 https://api.siliconflow.cn/v1）。启用后检索策略自动升级 hybrid（关键词 RRF 融合向量）；任何嵌入失败自动降级关键词，不阻塞对话。"),
        h("div", { className: "form-grid" },
          f("embedding.baseUrl", "服务地址", "https://api.siliconflow.cn/v1"),
          f("embedding.apiKey", "API Key", "sk-…"),
          f("embedding.model", "模型", "BAAI/bge-m3"),
          f("embedding.dimensions", "维度", "必须与模型输出一致", "number"),
          f("embedding.maxInputChars", "单条上限（字符）", "", "number"),
          f("embedding.timeoutMs", "超时（ms）", "", "number"),
        ),
        status ? h("div", { className: "note mt" },
          `已索引 ${status.indexed} 条${status.sourceChanged ? "（源已切换，待重嵌）" : ""}${status.reindexing ? ` · 重嵌中 ${status.reindexProgress.done}/${status.reindexProgress.total}` : ""}${status.circuitOpen ? " · 熔断中（自动降级关键词）" : ""}${status.lastError ? ` · 最近错误: ${status.lastError}` : ""}`,
        ) : null,
        h("div", { className: "row-inline mt" },
          h("button", { className: btn, onClick: () => action({ action: "reindex" }, "重嵌已完成") }, "重建向量索引"),
          status && status.reindexing ? h("button", { className: btn, onClick: () => action({ action: "cancel" }, "已请求取消") }, "取消重嵌") : null,
          h("button", { className: btnDanger, onClick: () => action({ action: "clear" }, "向量缓存已清空") }, "清空向量"),
          msg ? h("span", { className: "note", style: { color: msg.startsWith("失败") ? C.red : C.green } }, msg) : null,
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
      const area = { minHeight: "52px", resize: "vertical" };
      return h("div", { className: "card card-pad" },
        h("div", { className: "card-head" },
          h("h3", null, "知识库索引"),
          status ? tag(status.enabled ? (status.files > 0 ? "tag-green" : "tag-amber") : "tag-outline",
            status.enabled
              ? (status.files > 0 ? `就绪 ${status.files} 文件 / ${status.chunks} 片段${status.semanticReady ? ` · 语义 ${status.vectorCount}/${status.chunks}` : ""}` : "未索引到文件")
              : "关闭") : null,
        ),
        h("div", { className: "note" },
          "扫描本地知识库目录（如 Obsidian 库），把 md/txt 内容按段落分块并入召回——模型直接拿到文件内容，而不是只知道位置。自动跳过 .obsidian/.git 等噪音目录；保存后每 10 分钟增量扫描；配置嵌入源后片段自动升级语义检索（hybrid）。"),
        h("textarea", { className: "textarea", style: area, placeholder: "每行一个目录，例如 C:\\Users\\me\\Documents\\MyVault", value: pathsText, onChange: (e) => setPaths(e.target.value) }),
        h("div", { className: "row-inline mt" },
          h("span", { className: "field-label" }, "每轮片段上限"),
          h("input", { className: "inp-text", style: { width: "60px" }, type: "number", min: 1, max: 10, value: getIn(cfg, "knowledge.maxResults") ?? 3, onChange: (e) => setCfg((prev) => setIn(prev, "knowledge.maxResults", Number(e.target.value))) }),
          h("span", { className: "field-label" }, "总字符预算"),
          h("input", { className: "inp-text", style: { width: "72px" }, type: "number", value: getIn(cfg, "knowledge.maxTotalChars") ?? 1200, onChange: (e) => setCfg((prev) => setIn(prev, "knowledge.maxTotalChars", Number(e.target.value))) }),
          h("button", { className: btn, onClick: rescan }, "立即扫描"),
          msg ? h("span", { className: "note", style: { color: msg.startsWith("失败") ? C.red : C.green } }, msg) : null,
        ),
        status && status.lastError ? h("div", { className: "note mt", style: { color: C.red } }, `最近错误: ${status.lastError}`) : null,
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
      if (!cfg) return h("div", { className: "empty" }, "加载中…");
      return h("div", { className: "view-pad" },
        h("div", { className: "page-head" },
          h("div", null,
            h("h1", null, "自动化"),
            h("p", null, "开关、会话记忆、蒸馏路由链、语义检索与知识库索引"),
          ),
          h("div", { className: "h-actions" },
            h("button", { className: btnPrimary, onClick: save }, "保存配置"),
            saved ? h("span", { className: "note", style: { color: saved.startsWith("已") ? C.green : C.red } }, saved) : null,
          ),
        ),
        h("div", { className: "card card-pad" },
          h("div", { className: "card-head" },
            h("h3", null, "开关"),
            h("span", { className: "sub" }, "总开关关闭后捕获、蒸馏、注入全部暂停"),
          ),
          TOGGLES.map(([_, path, label, desc]) => h("label", { key: path, className: "toggle-row" },
            h("div", { className: "tr-body" },
              h("div", { className: "tr-title" }, label),
              h("div", { className: "tr-desc" }, desc),
            ),
            h("input", { type: "checkbox", className: "switch-input", checked: Boolean(getIn(cfg, path)), onChange: (e) => setCfg((prev) => setIn(prev, path, e.target.checked)) }),
            h("span", { className: "switch" }, h("span", { className: "slider" })),
          )),
        ),
        h("div", { className: "card card-pad" },
          h("div", { className: "card-head" },
            h("h3", null, "默认记忆档位"),
            h("span", { className: "sub" }, "新会话的默认档位；已有会话可在下方会话列表单独覆盖"),
          ),
          h("div", { className: "row-inline" },
            h("div", { className: "field", style: { maxWidth: "280px" } },
              h("div", { className: "field-label" }, "默认记忆档位"),
              h("select", { className: "select inp", value: cfg.family || "auto", onChange: (e) => setCfg((prev) => setIn(prev, "family", e.target.value)) },
                h("option", { value: "auto" }, "智能（双族自动归档）"),
                h("option", { value: "chat" }, "日常（个人域）"),
                h("option", { value: "work" }, "工作（工作域）"),
              ),
            ),
          ),
        ),
        h(SessionsCard, null),
        h(RouteChainCard, { cfg, setCfg }),
        h(EmbeddingCard, { cfg, setCfg }),
        h(KnowledgeCard, { cfg, setCfg }),
        h("div", { className: "card card-pad" },
          h("div", { className: "card-head" },
            h("h3", null, "蒸馏与召回参数"),
            h("span", { className: "sub" }, "抽取、召回、时效与超时的全局数值"),
          ),
          h("div", { className: "form-grid" },
            NUMBERS.map(([path, label]) => h("div", { key: path, className: "field" },
              h("div", { className: "field-label" }, label),
              h("input", { className: "inp-text", type: "number", value: getIn(cfg, path) ?? "", onChange: (e) => setCfg((prev) => setIn(prev, path, Number(e.target.value))) }),
            )),
          ),
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
        h("div", { className: cx(row, "mt"), style: { marginTop: "4px" } },
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
      const etaMs = running && build.batches > 0 && build.total > build.batches
        ? (build.elapsedMs / build.batches) * (build.total - build.batches)
        : 0;
      const progressBlock = running
        ? h("div", { className: "card card-pad mt" },
            h("div", { className: "row-inline", style: { justifyContent: "space-between", fontSize: "12.5px", color: C.muted } },
              h("span", null, `正在整合场景：第 ${build.batches}/${build.total || "?"} 批${build.lastFamily ? `（${build.lastFamily}）` : ""}`),
              h("span", null, `剩余待整合 ${build.pendingAfter} 条｜已跑 ${fmtDur(build.elapsedMs)}｜预计还需 ${etaMs > 0 ? fmtDur(etaMs) : "计算中"}`)),
            h("div", { className: "dshm-progress mt", style: { marginTop: "10px" } }, h("div", { style: { width: `${build.total ? (build.batches / build.total) * 100 : 0}%` } })))
        : build && build.finishedAt
          ? h("div", { className: "note" },
              `上次整合：${build.batches} 批，待整合 ${build.pendingBefore} → ${build.pendingAfter} 条（用时 ${fmtDur(build.elapsedMs)}）${build.skipped ? `｜跳过 ${build.skipped} 条（模型输出受限，内容更新后重试）` : ""}${build.error ? `｜出错：${build.error}` : ""}`)
          : null;
      const pageHead = h("div", { className: "page-head" },
        h("div", null,
          h("h1", null, "记忆洞察"),
          h("p", null, "覆盖率、沉睡、近重复与召回质量的体检看板"),
        ),
        h("div", { className: "h-actions" },
          note ? h("span", { className: "note", style: { maxWidth: "280px" } }, note) : null,
          h("button", { className: cx("btn btn-sm", busy === "__auto" && "btn-disabled"), disabled: busy === "__auto" || running, onClick: autoMerge },
            busy === "__auto" ? "合并中…" : "自动合并"),
          h("button", { className: cx("btn btn-sm", busy === "__scenemerge" && "btn-disabled"), disabled: busy === "__scenemerge" || running, onClick: sceneMerge },
            busy === "__scenemerge" ? "合并中…" : "合并同名场景"),
          h("button", { className: cx("btn btn-sm", busy === "__scenes" && "btn-disabled"), disabled: busy === "__scenes" || running, onClick: startBuild },
            running ? "整合中…" : busy === "__scenes" ? "启动中…" : "整合场景积压"),
          h("button", { className: "btn btn-sm btn-ghost", disabled: busy === "__undo" || running, onClick: () => undoMerge(false) },
            busy === "__undo" ? "撤销中…" : "撤销上次合并"),
          h("button", { className: "btn btn-sm btn-primary", disabled: busy === "__audit", onClick: recheck },
            busy === "__audit" ? "体检中…" : "重新体检"),
        ),
      );
      if (!report) {
        return h("div", { className: "view-pad" }, pageHead, progressBlock,
          h("div", { className: "empty" }, "加载中…"));
      }
      const c = report.coverage || {};
      const head = report.head || {};
      const sleep = report.sleeping || {};
      const dup = report.duplicates || {};
      const sc = scenes || {};
      const len = report.length || {};
      const kinds = report.byKind || {};
      const zeroPct = c.total > 0 ? Math.round((c.zero / c.total) * 1000) / 10 : 0;
      return h("div", { className: "view-pad" },
        pageHead,
        progressBlock,
        h("div", { className: "grid grid-5" },
          stat("记忆总量", report.total, `fact ${kinds.fact} · opinion ${kinds.opinion} · commitment ${kinds.commitment}`),
          stat("召回覆盖率", `${c.hitPct}%`, `命中 ≥10 次 ${head.manyHits} 条`),
          stat("从未召回", c.zero, `占 ${zeroPct}%`),
          stat("沉睡", sleep.count, `沉默口径 ${sleep.sleepDays} 天`),
          stat("重量重组", dup.groupCount, `待处理 ${dup.mergable} 条`),
        ),
        h("div", { className: "grid grid-3 mt" },
          stat("可合并", dup.mergable, `${dup.groupCount} 组近重复`),
          stat("场景", sc.total == null ? "—" : sc.total, `长度中位 ${len.median} · p90 ${len.p90}`),
          stat("待整合", pending ? pending.chat + pending.work : "—", "L0 对话排队中"),
        ),
        dup.groupCount > 0 ? h("div", { className: "card card-pad mt" },
          h("div", { className: "card-head" },
            h("h3", null, `近重复 ${dup.groupCount} 组 · 可合并 ${dup.mergable} 条`),
            h("button", { className: "btn btn-sm", onClick: () => setOpen(!open) }, open ? "收起" : "展开逐组合并"),
          ),
          h("div", { className: "note" }, "合并不可逆；召回次数取较大值（不累加），避免重复膨胀。"),
          open ? h("div", { className: "rows" }, (dup.groups || []).map((g) => h("div", { key: g.keepId, className: "row" },
            h("div", { className: "r-main" },
              h("div", { className: "r-title" }, `${g.size} 条 · 族 ${g.family}`),
              h("div", { className: "r-sub" }, String(g.suggestedContent || "").slice(0, 140)),
            ),
            h("div", { className: "r-meta" },
              h("span", { className: "v" }, `合并后 hits ${g.mergedHits}`),
              h("button", {
                className: "btn btn-sm",
                disabled: busy === g.keepId,
                onClick: () => merge(g),
              }, busy === g.keepId ? "合并中…" : "合并这组"),
              h("span", { className: "k" }, `保留 ${g.keepId.slice(0, 8)}，并入 ${g.size - 1} 条`),
            ),
          ))) : null,
        ) : null,
        sleep.count > 0 ? h("div", { className: "card card-pad mt" },
          h("div", { className: "card-head" },
            h("h3", null, `沉睡记忆 ${sleep.count} 条`),
            h("span", { className: "sub" }, `超过 ${sleep.sleepDays} 天没被召回，占着索引位置却从没被召回`),
          ),
          h("div", { className: "note" }, "确认没用再删，删了不可恢复。"),
          h("div", { className: "rows" }, (sleep.samples || []).map((item) => h("div", { key: item.id, className: "row" },
            h("div", { className: "r-main" },
              h("div", { className: "r-title" }, String(item.content || item.excerpt || "").slice(0, 140)),
            ),
            h("div", { className: "r-meta" },
              h("span", { className: "v" }, `${item.days || "?"} 天`),
              h("button", { className: "btn btn-sm btn-danger", disabled: busy === item.id, onClick: () => dropSleeping(item) },
                busy === item.id ? "删除中…" : "删除"),
            ),
          ))),
        ) : null,
        // 记忆测试卡：体检的第五个维度——召回准不准（只读）
        h("div", { className: "card card-pad mt" },
          h("div", { className: "card-head" },
            h("h3", null, "召回质量测试卡"),
            h("div", { className: "h-actions" },
              h("button", { className: "btn btn-sm btn-primary", disabled: busy === "__test", onClick: runRecallTest },
                busy === "__test" ? "测试中…" : test ? "再跑一次" : "跑测试卡"),
              test ? h("button", { className: "btn btn-sm btn-ghost", onClick: () => setTestOpen(!testOpen) },
                testOpen ? "收起" : "看考题") : null,
            ),
          ),
          h("div", { className: "note" },
            "抽够旧的记忆当考题，只给一半提示，看召回时能不能把它排进前列——体检的其余指标只看结构，这张卡看的是「召回得准不准」。只读，不改记忆。"),
          test ? h("div", { className: "grid grid-5 mt" },
            stat("得分", `${test.score}`),
            stat("命中", test.hit),
            stat("半对", test.half),
            stat("记错", test.miss),
            stat("考题池", test.poolSize),
          ) : null,
          test && test.items && test.items.length > 0 ? h("div", { className: "note" },
            `池龄 ≥${test.minAgeDays} 天｜前 ${test.topK} 名算半对、第 1 名算命中｜样例池 ${test.poolSize} 条`) : null,
          testOpen && test && test.items && test.items.length > 0 ? h("div", { className: "rows mt" },
            (test.items || []).map((t) => h("div", { key: t.id, className: "row" },
              h("div", { className: "r-main" },
                h("div", { className: "r-title" }, `${t.verdict === "hit" ? "命中" : t.verdict === "half" ? "半对" : "记错"}｜排第 ${t.rank || "—"} 名｜${t.ageDays} 天前｜族 ${t.family}`),
                h("div", { className: "r-sub" }, `提示：${t.hint}`),
                h("div", { className: "r-sub" }, `答案：${String(t.answer || "").slice(0, 140)}`),
              ),
              h("div", { className: "r-meta" },
                h("span", { className: "k" }, "召回候选"),
                h("span", { className: "v" }, (t.candidates || []).map((c) => `#${c.id}(${c.score})`).join(" ") || "（无）"),
              ),
            ))) : null,
        ),
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
      const byDay = (data && data.byDay) || [];
      const dayTotal = byDay.reduce((s, d) => s + (d.outputTokens || 0), 0);
      const dayAdded = byDay.reduce((s, d) => s + (d.added || 0), 0);
      const dayCalls = byDay.reduce((s, d) => s + (d.calls || 0), 0);
      // 资产活动柱状：SVG
      const BW = 1000, BH = 260, barGap = 40, barW = byDay.length > 0 ? (BW - barGap * (byDay.length + 1)) / byDay.length : 0;
      const rec = (data && data.recall) || {};
      return h("div", { className: "view-pad" },
        h("div", { className: "page-head" },
          h("div", null,
            h("h1", null, "洞察"),
            h("p", null, "成本、活动、召回与会话的统计明细"),
          ),
        ),
        h(HealthCard, null),
        h("div", { className: "card card-pad mt" },
          h("div", { className: "card-head" },
            h("div", null,
              h("h3", null, "蒸馏成本"),
              h("span", { className: "sub" }, `近 ${days} 天 · 按${granularity === "day" ? "天" : granularity === "week" ? "周" : "月"} · 全部层级 · 共 ${fmtTokens(dayTotal)} tok`),
            ),
            h("div", { className: "h-actions" },
              h("select", { className: "select inp", value: String(days), onChange: (e) => setDays(Number(e.target.value)) },
                [1, 7, 14, 30, 90, 365].map((d) => h("option", { key: d, value: d }, `近 ${d} 天`))),
              h("select", { className: "select inp", value: granularity, onChange: (e) => setGranularity(e.target.value) },
                h("option", { value: "day" }, "按天"), h("option", { value: "week" }, "按周"), h("option", { value: "month" }, "按月")),
              h("select", { className: "select inp", value: layer, onChange: (e) => setLayer(e.target.value) },
                h("option", { value: "" }, "全部层级"), h("option", { value: "l1" }, "L1 抽取"), h("option", { value: "l2" }, "L2 场景"), h("option", { value: "l3" }, "L3 画像")),
            ),
          ),
          h("div", { className: "chart-wrap", style: { marginTop: "12px" } },
            h(TrendChart, { trend: data && data.trend }),
          ),
        ),
        h("div", { className: "card card-pad mt" },
          h("div", { className: "card-head" },
            h("h3", null, "资产活动"),
            h("span", { className: "sub" }, "每日蒸馏产出与新增记忆"),
          ),
          byDay.length === 0 ? h("div", { className: "empty" }, "该窗口内还没有蒸馏活动。")
            : h("div", { className: "chart-wrap", style: { marginTop: "12px" } },
                h("svg", { viewBox: `0 0 ${BW} ${BH}`, preserveAspectRatio: "none" },
                  byDay.map((d, i) => {
                    const hgt = Math.max(4, (d.outputTokens / maxDay) * (BH - 40));
                    const x = barGap + i * (barW + barGap);
                    return h("g", { key: d.day },
                      h("rect", { x, y: BH - 34 - hgt, width: barW, height: hgt, rx: 6, fill: "var(--dshm-brand-500)", opacity: 0.9 }),
                      h("text", { x: x + barW / 2, y: BH - 14, className: "chart-axis", textAnchor: "middle", style: { fontSize: "12px" } }, d.day.slice(5)),
                    );
                  }),
                )),
          h("div", { className: "metric-row" },
            h("div", { className: "m" }, h("span", { className: "k" }, "新增记忆"), h("span", { className: "v" }, String(dayAdded))),
            h("div", { className: "m" }, h("span", { className: "k" }, "蒸馏调用"), h("span", { className: "v" }, String(dayCalls))),
          ),
        ),
        h("div", { className: "card card-pad mt" },
          h("div", { className: "card-head" },
            h("h3", null, "召回与会话"),
            h("span", { className: "sub" }, "注入统计与会话停用分布"),
          ),
          h("div", { className: "metric-row" },
            h("div", { className: "m" }, h("span", { className: "k" }, "累计注入轮次"), h("span", { className: "v" }, String(rec.recallInjections || 0))),
            h("div", { className: "m" }, h("span", { className: "k" }, "累计注入记忆"), h("span", { className: "v" }, String(rec.recallRecords || 0))),
            h("div", { className: "m" }, h("span", { className: "k" }, "最后注入"), h("span", { className: "v" }, relTime(rec.lastRecallAt))),
          ),
          data && data.sessionModes ? h("div", { className: "note" },
            `会话停用分布：暂停 ${data.sessionModes.off} · 只写 ${data.sessionModes.wo}`,
          ) : null,
        ),
        h("div", { className: "card card-pad mt" },
          h("div", { className: "card-head" },
            h("h3", null, `蒸馏调用明细`),
            h("span", { className: "sub" }, `近 ${days} 天 · 按模型`),
          ),
          !data || (data.byModel || []).length === 0
            ? h("div", { className: "empty" }, "还没有蒸馏调用记录。")
            : h("table", { className: "rtable" },
                h("thead", null, h("tr", null, ["模型", "调用", "失败", "输出 token", "思考 token", "均值", "中位数", "输入字符"].map((th) =>
                  h("th", { key: th }, th)))),
                h("tbody", null,
                  data.byModel.map((m) => h("tr", { key: m.model },
                    h("td", { className: "cond" }, m.model),
                    h("td", null, m.calls),
                    h("td", { className: m.failures > 0 ? "fail" : null }, m.failures),
                    h("td", null, fmtTokens(m.outputTokens)),
                    h("td", null, fmtTokens(m.reasoningTokens)),
                    h("td", null, fmtTokens(m.avgOutput)),
                    h("td", null, fmtTokens(m.medianOutput)),
                    h("td", null, fmtTokens(m.inChars)),
                  )),
                  (data && data.byLayer || []).length > 0
                    ? h("tr", { className: "sub" }, h("td", { colSpan: 8 }, "层级分布：" + data.byLayer.map((l) => `${l.layer} ${l.calls} 次 / ${fmtTokens(l.outputTokens)} tok`).join(" · ")))
                    : null,
                  (data && data.failures || []).length > 0
                    ? h("tr", { className: "err" }, h("td", { colSpan: 8 }, "近期失败：" + data.failures.slice(0, 3).map((f) => `[${f.layer}] ${f.error || "unknown"}`).join("；")))
                    : null,
                ),
              ),
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
      const syncField = (key, label, placeholder, type) => h("div", { className: "field" },
        h("div", { className: "field-label" }, label),
        h("input", {
          className: "inp-text", placeholder, type: type || "text",
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
      // 同步卡 kv 区（6 项）
      const syncKv = syncSt ? [
        { k: "本机", v: `${syncSt.deviceName || "未命名"} · ${String(syncSt.deviceId || "").slice(0, 12)}` },
        { k: "本机记忆", v: `${syncSt.local.records} 条 · 场景 ${syncSt.local.scenes} · 偏差 ${syncSt.local.biases}` },
        syncSt.remote
          ? { k: "远端", v: `${syncSt.remote.deviceName || syncSt.remote.deviceId} · ${relTime(syncSt.remote.updatedAt)} 上传` }
          : { k: "远端", v: "还没有快照" },
        syncSt.remote
          ? { k: "远端规模", v: `${syncSt.remote.records} 条 · ${(syncSt.remote.bytes / 1024).toFixed(0)}KB` }
          : null,
        syncSt.lastSync && (syncSt.lastSync.lastDownload || syncSt.lastSync.lastUpload)
          ? { k: "上次操作", v: [
              syncSt.lastSync.lastDownload ? `同步 ${relTime(syncSt.lastSync.lastDownload.at)}` : "",
              syncSt.lastSync.lastUpload ? `上传 ${relTime(syncSt.lastSync.lastUpload.at)}` : "",
            ].filter(Boolean).join(" · ") }
          : null,
        { k: "上次同步", v: syncSt.lastSync && syncSt.lastSync.lastDownload ? relTime(syncSt.lastSync.lastDownload.at) : "从未" },
      ].filter(Boolean) : [];
      const syncPanel = h("div", { className: "card card-pad" },
        h("div", { className: "card-head" },
          h("div", null,
            h("h3", null, "跨设备同步（GitHub 快照）"),
            h("span", { className: "sub" }, "两台设备各装一份：用完点上传，另一台点同步拉回来合并"),
          ),
          syncSt && syncSt.remoteError ? h("span", { className: "sub", style: { color: "var(--dshm-rose)" } }, "远端读取失败：" + syncSt.remoteError) : null,
        ),
        h("div", { className: "note" },
          "合并规则＝按 id 并集，同一条以更新时间晚的为准，召回次数取较大值（不累加，避免重复膨胀）。"),
        syncKv.length > 0 ? h("div", { className: "kv" }, syncKv.map((x) => h("div", { key: x.k, className: "kv-item" },
          h("span", { className: "k" }, x.k),
          h("span", { className: "v" }, x.v),
        ))) : null,
        syncForm ? h("div", { className: "form-grid mt" },
          syncField("repo", "GitHub 仓库（owner/repo）", "Hickey-Yuze/dsh-memory-sync"),
          syncField("token", "GitHub Token（细粒度，只给该仓库 contents 读写）", syncSt && syncSt.hasToken ? "已配置（留空＝不改）" : "github_pat_…", "password"),
          syncField("branch", "分支", "main"),
          syncField("deviceName", "本机名称（可留空，用主机名）", "Mac mini"),
          h("label", { className: "toggle-row", style: { gridColumn: "1 / -1" } },
            h("span", { className: "tr-body" },
              h("span", { className: "tr-title" }, "连 L0 原始对话一起同步"),
              h("span", { className: "tr-desc" }, "体积 +2MB，一般不需要"),
            ),
            h("input", { className: "switch-input", type: "checkbox", checked: Boolean(syncForm.includeL0), onChange: (e) => setSyncForm({ ...syncForm, includeL0: e.target.checked }) }),
            h("span", { className: "switch" }, h("span", { className: "slider" })),
          ),
          h("div", { className: "row-inline", style: { gridColumn: "1 / -1" } },
            h("button", { className: "btn btn-primary", onClick: saveSyncCfg }, "保存配置"),
            h("button", { className: "btn", onClick: () => setSyncForm(null) }, "取消"),
          ),
        ) : h("div", { className: "h-actions mt" },
          h("button", { className: "btn btn-sm", onClick: () => setSyncForm({
            enabled: true, repo: (syncSt && syncSt.repo) || "", branch: (syncSt && syncSt.branch) || "main",
            token: "", deviceName: (syncSt && syncSt.deviceName) || "", includeL0: Boolean(syncSt && syncSt.includeL0),
          }) }, syncSt && syncSt.configured ? "修改配置" : "配置同步"),
          h("button", { className: "btn btn-sm btn-primary", disabled: !syncSt || !syncSt.configured || syncBusy === "upload", onClick: doUpload }, syncBusy === "upload" ? "上传中…" : "上传到远端"),
          h("button", { className: "btn btn-sm", disabled: !syncSt || !syncSt.configured || syncBusy === "download", onClick: doDownload }, syncBusy === "download" ? "同步中…" : "从远端同步"),
          h("span", { className: "note", style: { marginLeft: "auto" } }, syncSt && syncSt.configured ? "" : "先配置仓库与 token"),
        ),
        syncBusy ? h("div", { className: "dshm-busy mt" },
          h("span", { className: "dshm-busy-icon" }, "⏳"),
          syncBusy === "download"
            ? `正在从远端下载快照并合并（约 600KB，跨境网络一般 20–40 秒）… 已等待 ${syncWaited} 秒，请不要关闭页面。`
            : `正在读取远端快照 → 合并本机 → 再上传（约 20–40 秒）… 已等待 ${syncWaited} 秒，请不要关闭页面。`,
        ) : null,
        syncMsg ? (() => {
          const icon = syncMsg.kind === "ok" ? "✓" : syncMsg.kind === "warn" ? "!" : "✕";
          return h("div", { className: cx("dshm-msg", syncMsg.kind, "mt") },
            h("span", { className: "dshm-msg-icon" }, icon),
            syncMsg.text,
          );
        })() : null,
        syncSt ? h("div", { className: "note mt" },
          "不同步（各机本地）：",
          h("span", { className: "pill-list" }, (syncSt.localOnlyFiles || []).map((f) => h("span", { key: f, className: "pill" }, f))),
        ) : null,
      );
      return h("div", { className: "view-pad" },
        h("div", { className: "page-head" },
          h("div", null,
            h("h1", null, "维护"),
            h("p", null, "同步、重建、日志与危险操作"),
          ),
        ),
        syncPanel,
        h("div", { className: "card card-pad mt" },
          h("div", { className: "card-head" },
            h("h3", null, "全量重建"),
            h("span", { className: "sub" }, "丢弃现有 L1–L3 资产，从 L0 会话事实源重新蒸馏"),
          ),
          h("div", { className: "note" }, "L0 原始对话不受影响，但重建期间旧记忆会停用。"),
          rb && rb.phase === "running" ? h("div", { className: "mt" },
            h("div", { className: "dshm-progress" }, h("div", { style: { width: `${rb.total > 0 ? Math.round((rb.done / rb.total) * 100) : 0}%` } })),
            h("div", { className: "row-inline mt" },
              h("span", { style: { fontSize: "13px" } }, `${rb.done}/${rb.total}`),
              h("button", { className: "btn btn-sm", onClick: async () => { await post("/api-memory/rebuild", { action: "cancel" }); loadStatus(); } }, "取消"),
            ),
          ) : h("div", { className: "row-inline mt" },
            confirming !== "rebuild"
              ? h("button", { className: "btn btn-danger", onClick: () => setConfirming("rebuild") }, "全量重建…")
              : h("div", { className: "row-inline" },
                h("span", { style: { fontSize: "13px", color: "var(--dshm-rose)" } }, "确认重建？现有记忆资产将被清除后重新生成。"),
                h("button", { className: "btn btn-danger", onClick: startRebuild }, "确认"),
                h("button", { className: "btn", onClick: () => setConfirming("") }, "取消"),
              ),
            rb && rb.phase !== "running" && rb.phase ? h("span", { className: "note" },
              `上次重建：${rb.phase}（${relTime(rb.endedAt)}）`) : null,
          ),
          msg ? h("div", { className: "note mt" }, msg) : null,
        ),
        h("div", { className: "card card-pad mt" },
          h("div", { className: "card-head" },
            h("h3", null, "诊断日志"),
            h("span", { className: "sub" }, "info 级以上，最近 200 条"),
            h("div", { className: "h-actions" },
              h("button", { className: "btn btn-sm", onClick: loadLogs }, "刷新"),
            ),
          ),
          h("div", { className: "dshm-logbox" },
            logs.length === 0 ? "（暂无日志）" : logs.map((line, i) => h("div", { key: i, className: "logline" }, line)),
          ),
        ),
        h("div", { className: "card card-pad danger mt" },
          h("div", { className: "card-head" },
            h("h3", null, "危险区"),
            h("span", { className: "sub" }, "不可恢复，请先备份"),
          ),
          confirming !== "wipe"
            ? h("button", { className: "btn btn-danger mt", onClick: () => setConfirming("wipe") }, "清空记忆库…")
            : h("div", { className: "row-inline mt" },
              h("span", { style: { fontSize: "13px", color: "var(--dshm-rose)" } }, "将删除全部记忆资产（L0 会话保留）。再点一次连同 L0 一起删除。"),
              h("button", { className: "btn btn-danger", onClick: async () => { await post("/api-memory/wipe", { scope: "assets" }); setConfirming(""); setMsg("记忆资产已清空"); } }, "清空资产"),
              h("button", { className: "btn btn-danger", onClick: async () => { await post("/api-memory/wipe", { scope: "all" }); setConfirming(""); setMsg("记忆库已完全清空"); } }, "连 L0 一起删除"),
              h("button", { className: "btn", onClick: () => setConfirming("") }, "取消"),
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
        className: cx("chip-pill", (!sid && "chip-disabled")),
        style: {
          display: "inline-flex", alignItems: "center", gap: "6px",
          padding: "4px 10px", borderRadius: "999px", fontSize: "12px", whiteSpace: "nowrap",
          opacity: !sid ? 0.5 : 1, cursor: !sid ? "default" : "pointer",
        },
      },
        h("span", { className: "chip-dot", style: { background: dotColor } }),
        h("span", null, label),
        h("span", { style: { fontSize: "9px", color: "var(--dshm-text-3)" } }, "▼"),
      );

      const modeRow = (value, labelText, desc) => h("div", {
        key: `m-${value || "global"}`,
        onClick: () => act({ mode: value || null }),
        className: cx("mi", (entry && entry.mode || null) === (value || null) && "on"),
      },
        h("span", { className: "sp" }, labelText),
        desc ? h("span", { className: "desc" }, desc) : null,
        (entry && entry.mode || null) === (value || null) ? h("span", { className: "ok" }, "✓") : null,
      );
      const flowRow = (value, labelText) => h("div", {
        key: `f-${value}`,
        onClick: () => act({ recall: value === "follow" ? null : value === "on" }),
        className: cx("mi", curFlow === value && "on"),
      },
        h("span", { className: "sp" }, labelText),
        curFlow === value ? h("span", { className: "ok" }, "✓") : null,
      );

      const menu = !open ? null : h("div", {
        ref: menuRef,
        className: "chip-menu",
        style: {
          position: "fixed", left: pos.left, top: pos.top,
          background: opaqueBackdrop(anchorRef.current),
        },
      },
      h("div", { className: "mhead" },
        h("strong", { style: { fontSize: "12.5px" } }, "会话记忆"),
        h("span", { style: { fontSize: "11px", color: "var(--dshm-text-3)" } }, `默认档：${MODE_LABEL[info ? info.defaultMode : "auto"] || "auto"}`),
      ),
      h("div", { className: "mlabel" }, "记忆档位"),
      modeRow(null, "跟随全局", "默认档"),
      modeRow("auto", "智能", "双族自动"),
      modeRow("chat", "日常", "个人域"),
      modeRow("work", "工作", "工作域"),
      modeRow("off", "暂停", "完全隐身"),
      h("div", { className: "sep" }),
      h("div", { className: "mlabel" }, "数据流（读侧）"),
      flowRow("follow", "跟随全局"),
      flowRow("on", "读写"),
      flowRow("wo", "只写（沉淀但不注入）"),
      err ? h("div", { className: "merr" }, err) : null,
      );

      return h("div", { style: { display: "inline-flex", position: "relative" } }, chip, menu);
    }

    // ---------- 主组件 ----------
    // 主题跟随宿主：检测宿主 html/根元素的暗色标记，映射到 .dshm-root 的 data-theme
    function detectHostTheme() {
      try {
        const d = document.documentElement;
        if (d && (d.getAttribute("data-theme") === "dark" || d.classList.contains("dark") || d.classList.contains("theme-dark"))) return "dark";
        const b = document.body;
        if (b && b.classList.contains("dark")) return "dark";
      } catch { /* 忽略 */ }
      return "light";
    }
    let styleInjected = false;
    function injectStyle() {
      if (styleInjected || typeof document === "undefined") return;
      styleInjected = true;
      try {
        const el = document.createElement("style");
        el.setAttribute("data-dshm", "1");
        el.textContent = UI_CSS;
        (document.head || document.documentElement).appendChild(el);
      } catch (err) {
        console.error("[dsh-memory] inject style failed:", err);
      }
    }
    function ThemeBridge({ children }) {
      const [theme, setTheme] = useState(detectHostTheme);
      useEffect(() => {
        injectStyle();
        // 宿主可能随时切换主题，监听 MutationObserver 保持同步
        let mo = null;
        try {
          const target = document.documentElement || document.body;
          mo = new MutationObserver(() => setTheme(detectHostTheme()));
          mo.observe(target, { attributes: true, attributeFilter: ["class", "data-theme"] });
        } catch { /* 忽略 */ }
        return () => { if (mo) mo.disconnect(); };
      }, []);
      return h("div", { className: "dshm-root", "data-theme": theme }, children);
    }

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
      const navCount = (id) => {
        if (id === "library" && overview && overview.counts && overview.counts.records != null) return overview.counts.records;
        if (id === "bias" && overview && overview.counts && overview.counts.biases != null) return overview.counts.biases;
        if (id === "insights" && overview && overview.counts && overview.counts.scenes != null) return overview.counts.scenes;
        return null;
      };
      const inner = h("div", { className: "workbench", style: { minHeight: "300px" } },
        h("div", { className: "tabs", style: { position: "sticky", top: 0, zIndex: 20 } },
          TABS.map(([id, label]) => h("button", {
            key: id,
            className: cx("nav-item", tab === id && "on"),
            onClick: () => setTab(id),
          },
            h("span", null, label),
            navCount(id) != null ? h("span", { className: "nav-count" }, navCount(id)) : null,
          )),
        ),
        tab === "overview" ? h(OverviewTab, { data: overview, lastError, onJump: setTab }) : null,
        tab === "library" ? h(LibraryTab, null) : null,
        tab === "bias" ? h(BiasTab, null) : null,
        tab === "automation" ? h(AutomationTab, null) : null,
        tab === "insights" ? h(InsightsTab, null) : null,
        tab === "maintenance" ? h(MaintenanceTab, { onLastError: setLastError }) : null,
      );
      return h(ThemeBridge, null, inner);
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
