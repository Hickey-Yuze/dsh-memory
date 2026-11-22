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

    const UI_CSS = `:root{
      --dshm-brand:#4f6ef7; --dshm-brand-50:#eef2ff; --dshm-brand-100:#e0e7ff; --dshm-brand-700:#3b54d6;
      --dshm-green:#0d9f5c; --dshm-green-bg:#e6f7ef; --dshm-amber:#c77d1d; --dshm-amber-bg:#fdf3e2;
      --dshm-red:#d93b52; --dshm-red-bg:#fdecef; --dshm-purple:#7c4dd6; --dshm-purple-bg:#f2ebfd;
      --dshm-cyan:#0ea5b7; --dshm-cyan-bg:#e6f6f8; --dshm-sky:#1c8cd6; --dshm-sky-bg:#e8f3fc;
      --dshm-bg:#f5f6fa; --dshm-surface:#ffffff; --dshm-surface2:#fafbfe; --dshm-surface3:#f1f2f8;
      --dshm-border:#e7e9f1; --dshm-border2:#d8dbe7; --dshm-text:#1a1d29; --dshm-text2:#585c70; --dshm-text3:#8b90a5;
      --dshm-shadow-sm:0 1px 2px rgba(20,24,60,.05); --dshm-shadow-md:0 4px 14px rgba(20,24,60,.08);
      --dshm-r-sm:8px; --dshm-r-md:12px; --dshm-r-lg:16px;
      --dshm-font:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Helvetica Neue",Arial,sans-serif;
      --dshm-mono:"SF Mono",ui-monospace,Menlo,Consolas,monospace;
    }
    .dshm-root *{box-sizing:border-box;margin:0;padding:0}
    .dshm-root body{font-family:var(--dshm-font);font-size:14px;color:var(--dshm-text);background:var(--dshm-bg);-webkit-font-smoothing:antialiased}
    .dshm-root .app{max-width:1080px;margin:0 auto;padding:0 20px 48px}
    .dshm-root /* ---------- Tabs ---------- */
    .tabs{display:flex;gap:2px;position:sticky;top:0;z-index:20;background:var(--dshm-bg);padding:14px 0 0;border-bottom:1px solid var(--dshm-border)}
    .dshm-root .tabs .nav-item{display:inline-flex;align-items:center;gap:6px;padding:8px 15px;border:none;background:transparent;color:var(--dshm-text2);font-size:13.5px;font-weight:450;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}
    .dshm-root .tabs .nav-item:hover{color:var(--dshm-text)}
    .dshm-root .tabs .nav-item.on{color:var(--dshm-brand);border-bottom-color:var(--dshm-brand);font-weight:600}
    .dshm-root .tabs .nav-count{font-size:11px;font-weight:600;color:var(--dshm-brand);background:var(--dshm-brand-100);border-radius:10px;padding:1px 7px;min-width:18px;text-align:center}
    .dshm-root .workbench .view-pad{padding:18px 4px 28px}
    .dshm-root .tab{padding:9px 14px;font-size:13.5px;font-weight:500;color:var(--dshm-text2);border:none;background:transparent;cursor:pointer;border-bottom:2px solid transparent;border-radius:8px 8px 0 0;white-space:nowrap}
    .dshm-root .tab:hover{background:var(--dshm-surface3)}
    .dshm-root .tab.on{color:var(--dshm-brand);border-bottom-color:var(--dshm-brand);font-weight:600;background:var(--dshm-surface)}
    .dshm-root .tab .cnt{display:inline-block;margin-left:5px;padding:1px 6px;font-size:11px;font-weight:600;color:var(--dshm-text3);background:var(--dshm-surface3);border-radius:20px;vertical-align:1px}
    .dshm-root .tab.on .cnt{color:var(--dshm-brand);background:var(--dshm-brand-100)}
    .dshm-root /* ---------- 视图 ---------- */
    .view{display:none;padding-top:18px}
    .dshm-root .view.on{display:block}
    .dshm-root /* ---------- page-head ---------- */
    .page-head{margin-bottom:14px}
    .dshm-root .page-head h1{font-size:20px;font-weight:700;letter-spacing:-.2px}
    .dshm-root .page-head p{font-size:12.5px;color:var(--dshm-text3);margin-top:3px;word-break:break-word}
    .dshm-root /* ---------- card / grid / stat ---------- */
    .grid{display:grid;gap:14px;margin-bottom:14px}
    .dshm-root .grid-5{grid-template-columns:repeat(5,minmax(0,1fr))}
    .dshm-root .grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}
    .dshm-root .grid-2{grid-template-columns:repeat(2,minmax(0,1fr))}
    @media(max-width:900px){.dshm-root .grid-5{grid-template-columns:repeat(3,minmax(0,1fr))}.dshm-root .grid-3{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:640px){.dshm-root .grid-5,.dshm-root .grid-3,.dshm-root .grid-2{grid-template-columns:repeat(1,minmax(0,1fr))}}
    .dshm-root .card{background:var(--dshm-surface);border:1px solid var(--dshm-border);border-radius:var(--dshm-r-md);box-shadow:var(--dshm-shadow-sm)}
    .dshm-root .card-pad{padding:18px 20px}
    .dshm-root .card-head{display:flex;align-items:baseline;gap:10px;padding:13px 20px;border-bottom:1px solid var(--dshm-border)}
    .dshm-root .card-head h3{font-size:14.5px;font-weight:650}
    .dshm-root .card-head .sub{font-size:12px;color:var(--dshm-text3);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .dshm-root .card-head .spacer{flex:1}
    .dshm-root .card-body{padding:16px 20px;min-width:0;word-break:break-word;overflow-wrap:anywhere}
    .dshm-root .stat{padding:16px 18px}
    .dshm-root .stat .label{font-size:12.5px;color:var(--dshm-text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .dshm-root .stat .value{font-size:27px;font-weight:750;letter-spacing:-.5px;margin-top:5px;white-space:nowrap}
    .dshm-root .stat .trend{font-size:12px;color:var(--dshm-text3);margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .dshm-root .stat .trend b{color:var(--dshm-green);font-weight:600}
    .dshm-root .stat .trend b.r{color:var(--dshm-red);font-weight:600}
    .dshm-root .stat .trend b.a{color:var(--dshm-amber);font-weight:600}
    .dshm-root /* ---------- tag / badge ---------- */
    .tag{display:inline-block;padding:2px 9px;font-size:11px;font-weight:600;border-radius:20px;white-space:nowrap}
    .dshm-root .tag-blue{background:var(--dshm-brand-100);color:var(--dshm-brand-700)}
    .dshm-root .tag-green{background:var(--dshm-green-bg);color:var(--dshm-green)}
    .dshm-root .tag-amber{background:var(--dshm-amber-bg);color:var(--dshm-amber)}
    .dshm-root .tag-rose{background:var(--dshm-red-bg);color:var(--dshm-red)}
    .dshm-root .tag-purple{background:var(--dshm-purple-bg);color:var(--dshm-purple)}
    .dshm-root .tag-cyan{background:var(--dshm-cyan-bg);color:var(--dshm-cyan)}
    .dshm-root .tag-sky{background:var(--dshm-sky-bg);color:var(--dshm-sky)}
    .dshm-root .tag-outline{background:transparent;border:1px solid var(--dshm-border2);color:var(--dshm-text2)}
    .dshm-root .badge-count{display:inline-block;padding:1px 8px;font-size:11px;font-weight:700;color:var(--dshm-amber);background:var(--dshm-amber-bg);border-radius:20px}
    .dshm-root /* ---------- hero ---------- */
    .hero{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
    .dshm-root .hero .ok-big{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:650}
    .dshm-root .hero .dot{width:9px;height:9px;border-radius:50%;background:var(--dshm-green);box-shadow:0 0 0 3px var(--dshm-green-bg)}
    .dshm-root .hero .dot.amber{background:var(--dshm-amber);box-shadow:0 0 0 3px var(--dshm-amber-bg)}
    .dshm-root .hero .pill-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
    .dshm-root .hero .right{margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:4px}
    .dshm-root .hero .meta-line{font-size:12px;color:var(--dshm-text2);text-align:right;word-break:break-word;overflow-wrap:anywhere}
    .dshm-root .hero .meta-line b{color:var(--dshm-text);font-weight:600}
    .dshm-root /* ---------- feed ---------- */
    .feed{list-style:none}
    .dshm-root .feed li{display:flex;align-items:center;gap:10px;padding:9px 2px;border-bottom:1px solid var(--dshm-border);font-size:13px}
    .dshm-root .feed li:last-child{border-bottom:none}
    .dshm-root .feed .rail{width:8px;height:8px;border-radius:50%;background:var(--dshm-brand-100);flex:none}
    .dshm-root .feed .tags{display:flex;gap:5px;flex:none}
    .dshm-root .feed .txt{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .dshm-root .feed .time{font-size:11.5px;color:var(--dshm-text3);flex:none}
    .dshm-root /* ---------- toolbar / seg ---------- */
    .toolbar{display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap}
    .dshm-root .seg{display:inline-flex;background:var(--dshm-surface3);border-radius:9px;padding:3px;gap:2px}
    .dshm-root .seg button{border:none;background:transparent;padding:5px 13px;font-size:12.5px;font-weight:500;color:var(--dshm-text2);border-radius:7px;cursor:pointer;white-space:nowrap}
    .dshm-root .seg button.on{background:var(--dshm-surface);color:var(--dshm-text);font-weight:600;box-shadow:var(--dshm-shadow-sm)}
    .dshm-root .inp{display:inline-flex;align-items:center;gap:6px;background:var(--dshm-surface);border:1px solid var(--dshm-border);border-radius:8px;padding:6px 11px;font-size:13px;color:var(--dshm-text2);min-width:180px}
    .dshm-root .inp input{border:none;outline:none;background:transparent;font-size:13px;color:var(--dshm-text);width:100%}
    .dshm-root .inp input::placeholder{color:var(--dshm-text3)}
    .dshm-root select.sel{background:var(--dshm-surface);border:1px solid var(--dshm-border);border-radius:8px;padding:6px 10px;font-size:12.5px;color:var(--dshm-text);outline:none;cursor:pointer}
    .dshm-root .btn-sm{border:1px solid var(--dshm-border2);background:var(--dshm-surface);border-radius:8px;padding:5px 11px;font-size:12px;font-weight:550;color:var(--dshm-text2);cursor:pointer;white-space:nowrap}
    .dshm-root .btn-sm:hover{background:var(--dshm-surface3)}
    .dshm-root .btn-primary{border:none;background:var(--dshm-brand);color:#fff;border-radius:8px;padding:7px 15px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;box-shadow:0 2px 8px rgba(79,110,247,.28)}
    .dshm-root .btn-primary:hover{background:var(--dshm-brand-700)}
    .dshm-root .btn-danger{border:none;background:var(--dshm-red-bg);color:var(--dshm-red);border-radius:8px;padding:7px 15px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}
    .dshm-root .btn-danger:hover{background:var(--dshm-red);color:#fff}
    .dshm-root /* ---------- rows ---------- */
    .rows{border-top:1px solid var(--dshm-border)}
    .dshm-root .row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;padding:12px 2px;border-bottom:1px solid var(--dshm-border);align-items:start}
    .dshm-root .row .left{min-width:0}
    .dshm-root .row .r-top{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:3px}
    .dshm-root .row .r-title{font-size:13.5px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .dshm-root .row .id-chip{font-family:var(--dshm-mono);font-size:11px;color:var(--dshm-text3);background:var(--dshm-surface3);padding:1px 6px;border-radius:5px;flex:none;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .dshm-root .row .r-sub{font-size:12px;color:var(--dshm-text2);line-height:1.55;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;overflow-wrap:anywhere}
    .dshm-root .row .r-meta{display:flex;flex-direction:column;align-items:flex-end;gap:3px;font-size:11.5px;color:var(--dshm-text3);white-space:nowrap;flex:none}
    .dshm-root .row .r-meta b{color:var(--dshm-text2);font-weight:600}
    .dshm-root /* ---------- toggle / switch ---------- */
    .toggle-row{display:flex;align-items:center;gap:14px;padding:10px 2px;border-bottom:1px solid var(--dshm-border)}
    .dshm-root .toggle-row:last-child{border-bottom:none}
    .dshm-root .toggle-row .tr-body{flex:1;min-width:0}
    .dshm-root .toggle-row .tr-title{font-size:13.5px;font-weight:600}
    .dshm-root .toggle-row .tr-desc{font-size:12px;color:var(--dshm-text3);margin-top:1px;word-break:break-word;overflow-wrap:anywhere}
    .dshm-root .switch{position:relative;width:42px;height:25px;flex:none;cursor:pointer}
    .dshm-root .switch input{display:none}
    .dshm-root .switch .sl{position:absolute;inset:0;background:var(--dshm-border2);border-radius:25px;transition:.18s}
    .dshm-root .switch .sl::after{content:"";position:absolute;top:2px;left:2px;width:21px;height:21px;border-radius:50%;background:#fff;box-shadow:var(--dshm-shadow-sm);transition:.18s}
    .dshm-root .switch input:checked + .sl{background:var(--dshm-brand)}
    .dshm-root .switch input:checked + .sl::after{transform:translateX(17px)}
    .dshm-root /* ---------- flash ---------- */
    .flash{border-left:3px solid var(--dshm-brand)}
    .dshm-root .flash-rose{border-left:3px solid var(--dshm-red)}
    .dshm-root .flash-amber{border-left:3px solid var(--dshm-amber)}
    .dshm-root /* ---------- rtable ---------- */
    .rtable{width:100%;border-collapse:collapse;font-size:12.5px}
    .dshm-root .rtable th{text-align:left;font-size:11px;color:var(--dshm-text3);font-weight:600;padding:8px 10px;border-bottom:1px solid var(--dshm-border);white-space:nowrap}
    .dshm-root .rtable td{padding:8px 10px;border-bottom:1px solid var(--dshm-border);color:var(--dshm-text);word-break:break-word;overflow-wrap:anywhere}
    .dshm-root .rtable td.mono{font-family:var(--dshm-mono);font-size:12px}
    .dshm-root .rtable td.fail{color:var(--dshm-red);font-family:var(--dshm-mono);font-size:12px}
    .dshm-root .rtable tr.sub td{background:var(--dshm-surface2);color:var(--dshm-text2);font-size:12px}
    .dshm-root .rtable tr.err td{background:var(--dshm-red-bg);color:var(--dshm-red);font-family:var(--dshm-mono);font-size:11.5px}
    .dshm-root .rtable tr:last-child td{border-bottom:none}
    .dshm-root /* ---------- kv / pill ---------- */
    .kv{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 22px;padding:14px 20px}
    .dshm-root .kv .item{display:flex;justify-content:space-between;gap:12px;font-size:12.5px;padding-bottom:9px;border-bottom:1px dashed var(--dshm-border)}
    .dshm-root .kv .item .k{color:var(--dshm-text3);white-space:nowrap}
    .dshm-root .kv .item .v{color:var(--dshm-text);font-weight:600;text-align:right;word-break:break-all}
    .dshm-root .pill-list{display:flex;flex-wrap:wrap;gap:6px;padding:0 20px 14px}
    .dshm-root .pill{font-family:var(--dshm-mono);font-size:11px;color:var(--dshm-text2);background:var(--dshm-surface3);padding:2px 8px;border-radius:6px}
    .dshm-root /* ---------- field ---------- */
    .form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 18px}
    .dshm-root .field .f-label{font-size:12px;color:var(--dshm-text2);font-weight:550;margin-bottom:5px}
    .dshm-root .field .f-label .hint{color:var(--dshm-text3);font-weight:400}
    .dshm-root .field input,.dshm-root .field textarea,.dshm-root .field select{width:100%;border:1px solid var(--dshm-border);border-radius:8px;padding:7px 11px;font-size:13px;color:var(--dshm-text);outline:none;background:var(--dshm-surface);font-family:var(--dshm-font)}
    .dshm-root .field input:focus,.dshm-root .field textarea:focus{border-color:var(--dshm-brand);box-shadow:0 0 0 3px var(--dshm-brand-50)}
    .dshm-root .field textarea{resize:vertical;min-height:56px;line-height:1.5}
    .dshm-root .field .mono{font-family:var(--dshm-mono);font-size:12px}
    .dshm-root .note{font-size:12px;color:var(--dshm-text3);line-height:1.7;margin-top:10px;word-break:break-word;overflow-wrap:anywhere}
    .dshm-root .note b{color:var(--dshm-text2);font-weight:600}
    .dshm-root /* ---------- chain / chart ---------- */
    .chain-block{margin-bottom:12px}
    .dshm-root .chain-block .lbl{font-size:12px;color:var(--dshm-text2);font-weight:550;margin-bottom:5px;display:flex;gap:6px;align-items:center}
    .dshm-root .chart-wrap{padding:6px 4px 2px}
    .dshm-root .legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--dshm-text2);margin-top:8px}
    .dshm-root .legend .sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
    .dshm-root .metric-row{display:flex;gap:26px;flex-wrap:wrap;padding:4px 2px}
    .dshm-root .metric-row .m{font-size:13px;color:var(--dshm-text2);min-width:0}
    .dshm-root .metric-row .m b{display:block;font-size:17px;font-weight:700;color:var(--dshm-text);margin-bottom:2px}
    .dshm-root /* ---------- log ---------- */
    .logbox{font-family:var(--dshm-mono);font-size:11.5px;line-height:1.7;max-height:200px;overflow:auto;background:var(--dshm-surface2);border:1px solid var(--dshm-border);border-radius:10px;padding:10px 12px}
    .dshm-root .logbox .lv{display:inline-block;width:44px;color:var(--dshm-sky);font-weight:600}
    .dshm-root /* ---------- 同步卡 ---------- */
    .sync-note{font-size:12px;color:var(--dshm-text3);line-height:1.7;padding:0 20px 14px}
    .dshm-root .sync-acts{display:flex;gap:8px;padding:0 20px 16px;flex-wrap:wrap;align-items:center}
    .dshm-root .msg{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;padding:7px 12px;border-radius:8px}
    .dshm-root .msg.ok{background:var(--dshm-green-bg);color:var(--dshm-green)}
    .dshm-root .msg.warn{background:var(--dshm-amber-bg);color:var(--dshm-amber)}
    .dshm-root .msg.err{background:var(--dshm-red-bg);color:var(--dshm-red)}
    .dshm-root .msg.msg-busy{background:var(--dshm-brand-100);color:var(--dshm-brand-700);display:flex;align-items:flex-start;gap:6px}
    .dshm-root .msg .icon{font-weight:700;flex-shrink:0}
    .dshm-root .msg{word-break:break-word;overflow-wrap:anywhere}
    .dshm-root /* ---------- danger ---------- */
    .danger{border-color:var(--dshm-red);border-radius:var(--dshm-r-md)}
    .dshm-root .danger .card-head{border-bottom-color:var(--dshm-red)}
    .dshm-root .danger .card-head h3{color:var(--dshm-red)}
    .dshm-root /* ---------- chip ---------- */
    .chip-pill{display:inline-flex;align-items:center;gap:7px;padding:4px 12px 4px 9px;border:1px solid var(--dshm-border);border-radius:999px;background:var(--dshm-surface);font-size:12.5px;font-weight:550;color:var(--dshm-text2);cursor:pointer;box-shadow:var(--dshm-shadow-sm)}
    .dshm-chip .chip-dot{width:7px;height:7px;border-radius:50%;background:var(--dshm-green)}
    .dshm-chip .chip-dot.gray{background:var(--dshm-text3)}
    .dshm-chip .chip-dot.red{background:var(--dshm-red)}
    .dshm-chip .chip-menu{position:fixed;width:252px;background:var(--dshm-surface);border:1px solid var(--dshm-border);border-radius:12px;box-shadow:var(--dshm-shadow-md);z-index:50;overflow:hidden;font-size:13px}
    .dshm-chip .chip-menu .mhead{padding:10px 14px;border-bottom:1px solid var(--dshm-border);font-weight:650;font-size:13px;display:flex;justify-content:space-between;align-items:center}
    .dshm-chip .chip-menu .mlabel{padding:8px 14px 4px;font-size:11.5px;color:var(--dshm-text3);font-weight:600}
    .dshm-chip .chip-menu .mi{display:flex;align-items:center;gap:9px;padding:7px 14px;cursor:pointer;border:none;background:transparent;width:100%;text-align:left;font-size:13px;color:var(--dshm-text)}
    .dshm-chip .chip-menu .mi:hover{background:var(--dshm-surface3)}
    .dshm-chip .chip-menu .mi .desc{color:var(--dshm-text3);font-size:11.5px}
    .dshm-chip .chip-menu .mi .ok{margin-left:auto;color:var(--dshm-brand);font-weight:700}
    .dshm-chip .chip-menu .sep{height:1px;background:var(--dshm-border);margin:5px 0}
    .dshm-root .progress{height:6px;border-radius:3px;background:var(--dshm-surface3);overflow:hidden}
    .dshm-root .progress .bar{height:6px;background:var(--dshm-brand);transition:width .3s ease;border-radius:3px}
    .dshm-root .code-block{display:block;background:var(--dshm-surface2);border:1px solid var(--dshm-border);padding:8px 10px;border-radius:8px;font-family:var(--dshm-mono);font-size:12px;margin:6px 0 8px;word-break:break-all;overflow-wrap:anywhere}
    .dshm-root .pre-scroll{font-family:var(--dshm-mono);font-size:11px;color:var(--dshm-text2);white-space:pre-wrap;word-break:break-all;background:var(--dshm-surface2);border:1px solid var(--dshm-border);padding:8px;border-radius:8px;overflow:auto}
    /*__UI_CSS_END__*/`;

    // ---------- 样式基元（className 版，对应 UI_CSS） ----------
    const cx = (...parts) => parts.filter(Boolean).join(" ");
    const C = {
      brand: "var(--dshm-brand)", green: "var(--dshm-green)", amber: "var(--dshm-amber)",
      red: "var(--dshm-red)", purple: "var(--dshm-purple)", cyan: "var(--dshm-cyan)", sky: "var(--dshm-sky)",
      muted: "var(--dshm-text3)", border: "var(--dshm-border)", card: "var(--dshm-surface)",
      text: "var(--dshm-text)", text2: "var(--dshm-text2)", surface3: "var(--dshm-surface3)",
    };
    const card = "card card-pad";
    const row = "hero";
    const btn = "btn-sm";
    const btnPrimary = "btn-primary";
    const btnDanger = "btn-danger";
    const input = "inp";
    const tag = (cls, text) => h("span", { className: cx("tag", cls) }, text);
    const LAYER_LABEL = { memory: "记忆", scene: "场景", persona: "画像" };
    const LAYER_CLASS = { memory: "tag-blue", scene: "tag-green", persona: "tag-purple" };
    const VERB_LABEL = { added: "新增", updated: "更新", merged: "合并", deleted: "删除" };
    const VERB_CLASS = { added: "tag-green", updated: "tag-blue", merged: "tag-cyan", deleted: "tag-rose" };
    const FAMILY_LABEL = { chat: "个人", work: "工作" };
    const FAMILY_CLASS = { chat: "tag-blue", work: "tag-amber" };
    // 记忆类型（L1 记录的 kind）：fact 不显示徽标，只有非事实才标注，避免每条都挂标签
    const KIND_LABEL = { opinion: "我的判断", commitment: "待收束" };
    const KIND_CLASS = { opinion: "tag-purple", commitment: "tag-rose" };
    const KIND_TITLE = { opinion: "助手的主观判断或推测，未获用户确认，不可当事实使用", commitment: "尚未收束的事：待办、待排查、待拍板或进行中" };
    const MODE_LABEL = { auto: "智能", chat: "日常", work: "工作", off: "暂停" };
    const MODE_CLASS = { auto: "tag-blue", chat: "tag-cyan", work: "tag-amber", off: "tag-rose" };
    const stat = (label, value, trend) => h("div", { className: "card stat" },
      h("div", { className: "label" }, label),
      h("div", { className: "value" }, value),
      trend ? h("div", { className: "trend" }, trend) : null,
    );

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
      if (!data) return h("div", { className: "page-head" }, h("p", null, "加载中…"));
      const { counts, stats, activity, pendingDistill, rebuild, families, sessionModes } = data;
      const healthy = !props.lastError;
      return h("div", null,
        h("div", { className: "page-head" },
          h("h1", null, "记忆总览"),
          h("p", null, "运行状态、资产规模与最近活动一览"),
        ),
        // hero 状态卡
        h("div", { className: "card card-pad" },
          h("div", { className: "hero" },
            h("div", { className: "ok-big" },
              h("span", { className: cx("dot", healthy ? "" : "amber") }),
              h("strong", null, healthy ? "运行正常" : "有告警"),
            ),
            h("div", { className: "pill-row" },
              tag("tag-blue", "存储"),
              tag(counts.records + counts.scenes > 0 || counts.hasPersona ? "tag-green" : "tag-outline", "检索"),
              tag(stats.lastDistillAt ? "tag-green" : "tag-outline", "蒸馏队列"),
              pendingDistill > 0 ? h("span", { className: "badge-count" }, `待蒸馏 ${pendingDistill} 条`) : null,
            ),
            h("div", { className: "right" },
              h("div", { className: "meta-line" },
                h("b", null, `记忆 ${counts.records}`), `（个人 ${(families && families.chat && families.chat.records) || 0} · 工作 ${(families && families.work && families.work.records) || 0}）`,
                " · ", h("b", null, `场景 ${counts.scenes}`), " · ", h("b", null, `会话 ${counts.conversations}`),
              ),
              sessionModes && (sessionModes.off > 0 || sessionModes.wo > 0)
                ? h("div", { className: "meta-line" }, `会话停用分布：暂停 ${sessionModes.off} · 只写 ${sessionModes.wo}`)
                : null,
            ),
          ),
          props.lastError ? h("div", { className: "note", style: { color: C.amber } }, `最近告警：${props.lastError.message}`) : null,
          rebuild && rebuild.phase === "running" ? h("div", { className: "note", style: { color: C.brand } },
            `全量重建进行中：${rebuild.done}/${rebuild.total}`,
          ) : null,
        ),
        // 关键数字瓦片（grid-5）
        h("div", { className: "grid grid-5" },
          stat("记忆资产", String(counts.records), h("b", null, `${(families && families.chat && families.chat.records) || 0} 个人 · ${(families && families.work && families.work.records) || 0} 工作`)),
          stat("场景", String(counts.scenes), null),
          stat("偏差档案", String(counts.biases || 0), null),
          stat("本周蒸馏输出", fmtTokens(data.outputTokens7d), null),
          stat("上次蒸馏", relTime(stats.lastDistillAt), stats.lastDistillAt ? h("span", null, fmtTokens(data.distillCalls7d || 0), " 次调用") : null),
        ),
        // 最近活动
        h("div", { className: "card" },
          h("div", { className: "card-head" },
            h("h3", null, "最近活动"),
            h("span", { className: "sub" }, "记忆、场景与画像的沉淀流水"),
          ),
          activity.length === 0
            ? h("div", { className: "card-body" }, h("p", { className: "note" }, "还没有记忆活动。正常使用几轮对话后，第一批原子记忆会自动沉淀到这里。"))
            : h("ul", { className: "feed" }, activity.slice(0, 12).map((a, i) => h("li", { key: i },
                h("span", { className: "rail", style: { background: VERB_CLASS[a.verb] ? "var(--dshm-brand-100)" : "var(--dshm-surface3)" } }),
                h("span", { className: "tags" },
                  tag(VERB_CLASS[a.verb] || "tag-outline", VERB_LABEL[a.verb] || a.verb),
                  tag(LAYER_CLASS[a.layer] || "tag-outline", LAYER_LABEL[a.layer] || a.layer),
                  a.family ? tag(FAMILY_CLASS[a.family] || "tag-outline", FAMILY_LABEL[a.family] || a.family) : null,
                ),
                h("span", { className: "txt" }, a.title),
                h("span", { className: "time" }, relTime(a.ts)),
              ))),
        ),
      );
    }

    function tile(label, value) {
      return stat(label, value, null);
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
        h("div", { className: "page-head" },
          h("h1", null, "记忆库"),
          h("p", null, "L1 原子记忆、L2 场景与 L3 画像的检索与维护"),
        ),
        h("div", { className: "toolbar" },
          h("div", { className: "seg" },
            ["all", "chat", "work"].map((f) => h("button", {
              key: f, className: cx(family === f ? "on" : ""), onClick: () => setFamily(f),
            }, f === "all" ? "全部" : FAMILY_LABEL[f])),
          ),
          h("select", { className: "sel", value: type, onChange: (e) => setType(e.target.value) },
            h("option", { value: "all" }, "全部资产"),
            h("option", { value: "memory" }, "L1 记忆"),
            h("option", { value: "scene" }, "L2 场景"),
            h("option", { value: "persona" }, "L3 画像"),
          ),
          h("label", { className: "inp" },
            h("input", { placeholder: "搜索内容…", value: q, onChange: (e) => setQ(e.target.value) }),
          ),
          h("button", { className: btn, onClick: load }, "刷新"),
        ),
        items === null ? h("p", { className: "note" }, "加载中…")
          : items.length === 0 ? h("div", { className: "card card-pad" }, h("p", { className: "note" }, "没有匹配的记忆资产。"))
          : h("div", { className: "rows" }, items.map((item) => h("div", { key: item.kind + item.id, className: "row" },
            h("div", { className: "left" },
              h("div", { className: "r-top", style: { cursor: "pointer" }, onClick: () => setOpenId(openId === item.id ? null : item.id) },
                tag(LAYER_CLASS[item.kind] || "tag-outline", LAYER_LABEL[item.kind] || item.kind),
                item.family ? tag(FAMILY_CLASS[item.family] || "tag-outline", FAMILY_LABEL[item.family] || item.family) : null,
                item.kind === "memory" && item.memKind && item.memKind !== "fact"
                  ? h("span", { title: KIND_TITLE[item.memKind] || "" }, tag(KIND_CLASS[item.memKind] || "tag-outline", KIND_LABEL[item.memKind] || item.memKind))
                  : null,
                h("span", { className: "r-title" },
                  item.kind === "memory" ? item.content.slice(0, 90) : item.title),
              ),
              openId === item.id ? h("div", { className: "row-detail", style: { marginTop: "8px", paddingTop: "8px", borderTop: "1px solid var(--dshm-border)" } },
                h("div", { style: { whiteSpace: "pre-wrap", fontSize: "13px", lineHeight: 1.6 } }, item.content),
                h("div", { className: "hero", style: { marginTop: "10px", fontSize: "12px", color: C.muted } },
                  item.tags && item.tags.length > 0 ? h("span", null, "标签: " + item.tags.join("、")) : null,
                  item.kind === "memory" && item.hits != null ? h("span", null, `召回 ${item.hits} 次`) : null,
                  item.kind === "scene" ? h("span", null, `涵盖 ${item.recordCount} 条记忆`) : null,
                  h("span", { style: { flex: 1 } }),
                  h("button", { className: btn, onClick: () => navigator.clipboard && navigator.clipboard.writeText(item.content) }, "复制"),
                  item.kind === "memory" ? h("button", {
                    className: btnDanger,
                    onClick: async () => { await post("/api-memory/records/delete", { id: item.id }); load(); },
                  }, "删除") : null,
                ),
              ) : null,
            ),
            h("div", { className: "r-meta" },
              h("span", null, h("b", null, relTime(item.updatedAt))),
            ),
          ))),
      );
    }

    // ---------- 偏差档案 ----------
    const BIAS_KIND_LABEL = { judgment: "判断错", "recall-miss": "该召没召", "recall-noise": "召来噪音", route: "路由错" };
    const BIAS_KIND_CLASS = { judgment: "tag-rose", "recall-miss": "tag-amber", "recall-noise": "tag-amber", route: "tag-purple" };
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
        h("div", { className: "f-label" }, label),
        h("input", { placeholder, value: form[key] || "", onChange: (e) => setForm({ ...form, [key]: e.target.value }) }),
      );
      return h("div", null,
        h("div", { className: "page-head" },
          h("h1", null, "偏差档案"),
          h("p", null, "模型判断失误的留档：召回时只撞话题才注入（阈值 0.45，最多 1 条，与 L1 共用去重）"),
        ),
        h("div", { className: "toolbar" },
          h("div", { className: "seg" },
            ["all", "chat", "work"].map((f) => h("button", {
              key: f, className: cx(family === f ? "on" : ""), onClick: () => setFamily(f),
            }, f === "all" ? "全部" : FAMILY_LABEL[f])),
          ),
          h("span", { style: { flex: 1 } }),
          h("button", { className: btn, onClick: () => setForm(form ? null : { ...EMPTY_BIAS }) }, form ? "取消" : "手动入档"),
        ),
        msg ? h("p", { className: "note", style: { color: C.text2 } }, msg) : null,
        form ? h("div", { className: "card card-pad", style: { marginBottom: "14px" } },
          h("div", { className: "form-grid" },
            field("scene", "场景（什么情境）", "例如：dsh-memory 存量改盘"),
            field("deviation", "偏差（错在哪）", "例如：以为重启够快就不会被覆盖"),
            field("rootCause", "根因（为什么错）", "例如：写盘用的是插件内存里的旧值"),
            field("fix", "修正（下次怎么做）", "例如：先在 config overlay 关掉 extract.enabled 再落盘"),
          ),
          h("div", { className: "hero", style: { marginTop: "12px" } },
            h("select", { className: "sel", value: form.family, onChange: (e) => setForm({ ...form, family: e.target.value }) },
              h("option", { value: "chat" }, "个人"),
              h("option", { value: "work" }, "工作"),
            ),
            h("select", { className: "sel", value: form.kind, onChange: (e) => setForm({ ...form, kind: e.target.value }) },
              h("option", { value: "judgment" }, "判断错"),
              h("option", { value: "recall-miss" }, "该召没召"),
              h("option", { value: "recall-noise" }, "召来噪音"),
              h("option", { value: "route" }, "路由错"),
            ),
            h("span", { style: { flex: 1 } }),
            h("button", { className: btnPrimary, onClick: save }, "保存"),
          ),
        ) : null,
        data === null ? h("p", { className: "note" }, "加载中…")
          : data.biases.length === 0 ? h("div", { className: "card card-pad" }, h("p", { className: "note" }, "还没有偏差档案。模型可在出错当场用 memory_bias 入档，这里也能手动补。"))
          : h("div", null, data.biases.map((b) => h("div", { key: b.id, className: "card card-pad flash flash-rose", style: { marginBottom: "10px" } },
            h("div", { className: "hero" },
              h("span", { className: "id-chip" }, `B-${b.no}`),
              tag(BIAS_KIND_CLASS[b.kind] || "tag-outline", BIAS_KIND_LABEL[b.kind] || b.kind),
              tag(FAMILY_CLASS[b.family] || "tag-outline", FAMILY_LABEL[b.family] || b.family),
              h("span", { className: "r-meta", style: { marginLeft: "auto" } },
                h("span", null, h("b", null, b.date || "")),
                b.hits ? h("span", null, `召回 ${b.hits} 次`) : null,
              ),
              h("button", { className: btnDanger, onClick: async () => { await post("/api-memory/biases", { action: "delete", id: b.id }); load(); } }, "删除"),
            ),
            h("div", { className: "note", style: { marginTop: "8px", color: C.text } },
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
      return h("div", { className: "card" },
        h("div", { className: "card-head" },
          h("h3", null, "会话记忆档位"),
          h("span", { className: "sub" }, "新会话默认档"),
          h("span", { className: "spacer" }),
          h("b", null, data ? MODE_LABEL[data.defaultMode] || data.defaultMode : "…"),
          h("button", { className: btn, onClick: load }, "刷新"),
        ),
        h("div", { className: "card-body" },
          h("p", { className: "note" },
            "智能=双族自动归档；日常=只进个人域；工作=只进工作域；暂停=本会话对记忆系统隐身（不捕获不注入）。数据流「只写」照常沉淀记忆但不在本会话注入。"),
          !data ? h("p", { className: "note" }, "加载中…")
            : sessions.length === 0 ? h("p", { className: "note" }, "暂无活跃会话。")
            : h("div", { className: "rows" }, sessions.slice(0, 20).map((s, i) => h("div", { key: s.sid, className: "row" },
                h("div", { className: "left" },
                  h("div", { className: "r-top" },
                    h("span", { className: "id-chip" }, s.sid.slice(0, 14) + (s.sid.length > 14 ? "…" : "")),
                    tag(MODE_CLASS[s.effectiveMode] || "tag-outline", MODE_LABEL[s.effectiveMode] || s.effectiveMode),
                    s.recall === false ? tag("tag-amber", "只写") : null,
                    s.mode === "off" ? tag("tag-rose", "已暂停") : null,
                    s.count > 0 ? h("span", { className: "badge-count" }, `待蒸馏 ${s.count}`) : null,
                    h("span", { style: { flex: 1 } }),
                    h("select", { className: "sel", value: s.mode || "", onChange: (e) => setMode(s.sid, e.target.value) },
                      h("option", { value: "" }, `跟随全局（${MODE_LABEL[data.defaultMode]}）`),
                      h("option", { value: "auto" }, "智能"),
                      h("option", { value: "chat" }, "日常"),
                      h("option", { value: "work" }, "工作"),
                      h("option", { value: "off" }, "暂停"),
                    ),
                    h("select", { className: "sel", value: s.recall === false ? "wo" : s.recall === true ? "on" : "follow", onChange: (e) => setFlow(s.sid, e.target.value) },
                      h("option", { value: "follow" }, "数据流：跟随全局"),
                      h("option", { value: "on" }, "读写"),
                      h("option", { value: "wo" }, "只写"),
                    ),
                  ),
                ),
              ))),
          msg ? h("p", { className: "note", style: { color: C.green } }, msg) : null,
        ),
      );
    }

    function RouteChainCard({ cfg, setCfg }) {
      const fallbacksText = chainToText(getIn(cfg, "llm.fallbacks"));
      const layerText = (key) => chainToText(getIn(cfg, `llm.layerRoutes.${key}`));
      const update = (path, text) => setCfg((prev) => setIn(prev, path, textToChain(text)));
      return h("div", { className: "card" },
        h("div", { className: "card-head" },
          h("h3", null, "蒸馏路由链"),
          h("span", { className: "sub" }, "主路由失败时按序自动降级"),
        ),
        h("div", { className: "card-body" },
          h("p", { className: "note" }, "每行一条：provider|model[|思考档]，如 opencode-go|deepseek-v4-flash|low。"),
          h("div", { className: "chain-block" },
            h("div", { className: "lbl" }, "全局回退链（主路由之后依次尝试）"),
            h("textarea", { className: "field", style: { fontFamily: "var(--dshm-mono)", minHeight: "54px", resize: "vertical", width: "100%" }, value: fallbacksText, placeholder: "provider|model[|effort]，每行一条", onChange: (e) => update("llm.fallbacks", e.target.value) }),
          ),
          ["l1", "l2", "l3"].map((key) => h("div", { key, className: "chain-block" },
            h("div", { className: "lbl" }, `${key.toUpperCase()} 独立链（留空跟随全局）`),
            h("textarea", { className: "field", style: { fontFamily: "var(--dshm-mono)", minHeight: "44px", resize: "vertical", width: "100%" }, value: layerText(key), placeholder: "头行必须 provider|model", onChange: (e) => update(`llm.layerRoutes.${key}`, e.target.value) }),
          )),
        ),
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
        h("div", { className: "f-label" }, label),
        h("input", { type: type || "text", placeholder: placeholder || "", value: getIn(cfg, path) ?? "", onChange: (e) => setCfg((prev) => setIn(prev, path, type === "number" ? Number(e.target.value) : e.target.value)) }),
      );
      return h("div", { className: "card" },
        h("div", { className: "card-head" },
          h("h3", null, "语义检索（嵌入源）"),
          status ? tag(status.ready ? "tag-green" : status.enabled ? "tag-amber" : "tag-outline", status.ready ? "就绪" : status.enabled ? "配置不全" : "关闭") : null,
        ),
        h("div", { className: "card-body" },
          h("p", { className: "note" }, "OpenAI 兼容 /embeddings 服务（如 https://api.siliconflow.cn/v1）。启用后检索策略自动升级 hybrid；任何嵌入失败自动降级关键词，不阻塞对话。"),
          h("div", { className: "form-grid" },
            f("embedding.baseUrl", "服务地址", "https://api.siliconflow.cn/v1"),
            f("embedding.apiKey", "API Key", "sk-…"),
            f("embedding.model", "模型", "BAAI/bge-m3"),
            f("embedding.dimensions", "维度", "必须与模型输出一致", "number"),
            f("embedding.maxInputChars", "单条上限（字符）", "", "number"),
            f("embedding.timeoutMs", "超时（ms）", "", "number"),
          ),
          status ? h("p", { className: "note" },
            `已索引 ${status.indexed} 条${status.sourceChanged ? "（源已切换，待重嵌）" : ""}${status.reindexing ? ` · 重嵌中 ${status.reindexProgress.done}/${status.reindexProgress.total}` : ""}${status.circuitOpen ? " · 熔断中（自动降级关键词）" : ""}${status.lastError ? ` · 最近错误: ${status.lastError}` : ""}`,
          ) : null,
          h("div", { className: "hero", style: { marginTop: "12px" } },
            h("button", { className: btn, onClick: () => action({ action: "reindex" }, "重嵌已完成") }, "重建向量索引"),
            status && status.reindexing ? h("button", { className: btn, onClick: () => action({ action: "cancel" }, "已请求取消") }, "取消重嵌") : null,
            h("button", { className: btnDanger, onClick: () => action({ action: "clear" }, "向量缓存已清空") }, "清空向量"),
            msg ? h("span", { style: { fontSize: "12px", color: msg.startsWith("失败") ? C.red : C.green } }, msg) : null,
          ),
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
      return h("div", { className: "card" },
        h("div", { className: "card-head" },
          h("h3", null, "知识库索引"),
          status ? tag(status.enabled ? (status.files > 0 ? "tag-green" : "tag-amber") : "tag-outline",
            status.enabled
              ? (status.files > 0 ? `就绪 ${status.files} 文件 / ${status.chunks} 片段${status.semanticReady ? ` · 语义 ${status.vectorCount}/${status.chunks}` : ""}` : "未索引到文件")
              : "关闭") : null,
        ),
        h("div", { className: "card-body" },
          h("p", { className: "note" }, "扫描本地知识库目录（如 Obsidian 库），把 md/txt 内容按段落分块并入召回——模型直接拿到文件内容。自动跳过 .obsidian/.git 等噪音目录；保存后每 10 分钟增量扫描。"),
          h("textarea", { className: "field", style: { fontFamily: "var(--dshm-mono)", minHeight: "52px", resize: "vertical", width: "100%" }, placeholder: "每行一个目录，例如 C:\\Users\\me\\Documents\\MyVault", value: pathsText, onChange: (e) => setPaths(e.target.value) }),
          h("div", { className: "hero", style: { marginTop: "10px" } },
            h("span", { style: { fontSize: "12px", color: C.muted } }, "每轮片段上限"),
            h("input", { className: "sel", style: { width: "64px" }, type: "number", min: 1, max: 10, value: getIn(cfg, "knowledge.maxResults") ?? 3, onChange: (e) => setCfg((prev) => setIn(prev, "knowledge.maxResults", Number(e.target.value))) }),
            h("span", { style: { fontSize: "12px", color: C.muted } }, "总字符预算"),
            h("input", { className: "sel", style: { width: "76px" }, type: "number", value: getIn(cfg, "knowledge.maxTotalChars") ?? 1200, onChange: (e) => setCfg((prev) => setIn(prev, "knowledge.maxTotalChars", Number(e.target.value))) }),
            h("button", { className: btn, onClick: rescan }, "立即扫描"),
            msg ? h("span", { style: { fontSize: "12px", color: msg.startsWith("失败") ? C.red : C.green } }, msg) : null,
          ),
          status && status.lastError ? h("p", { className: "note", style: { color: C.red } }, `最近错误: ${status.lastError}`) : null,
        ),
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
      if (!cfg) return h("div", { className: "page-head" }, h("p", null, "加载中…"));
      return h("div", null,
        h("div", { className: "page-head" },
          h("h1", null, "自动化"),
          h("p", null, "捕获、蒸馏、召回与检索的管线开关与参数"),
        ),
        h("div", { className: "card" },
          h("div", { className: "card-head" },
            h("h3", null, "开关"),
            h("span", { className: "sub" }, "总开关关闭后捕获、蒸馏、注入全部暂停"),
          ),
          h("div", { className: "card-body" },
            TOGGLES.map(([_, path, label, desc]) => h("label", { key: path, className: "toggle-row", style: { cursor: "pointer" } },
              h("div", { className: "tr-body" },
                h("div", { className: "tr-title" }, label),
                h("div", { className: "tr-desc" }, desc),
              ),
              h("span", { className: "switch" },
                h("input", { type: "checkbox", checked: Boolean(getIn(cfg, path)), onChange: (e) => setCfg((prev) => setIn(prev, path, e.target.checked)) }),
                h("span", { className: "sl" }),
              ),
            )),
          ),
        ),
        h("div", { className: "card" },
          h("div", { className: "card-head" },
            h("h3", null, "默认记忆档位"),
            h("span", { className: "sub" }, "新会话的默认档位；已有会话可在下方会话列表单独覆盖"),
          ),
          h("div", { className: "card-body" },
            h("select", { className: "sel", value: cfg.family || "auto", onChange: (e) => setCfg((prev) => setIn(prev, "family", e.target.value)) },
              h("option", { value: "auto" }, "智能（双族自动归档）"),
              h("option", { value: "chat" }, "日常（个人域）"),
              h("option", { value: "work" }, "工作（工作域）"),
            ),
          ),
        ),
        h(SessionsCard, null),
        h(RouteChainCard, { cfg, setCfg }),
        h(EmbeddingCard, { cfg, setCfg }),
        h(KnowledgeCard, { cfg, setCfg }),
        h("div", { className: "card" },
          h("div", { className: "card-head" },
            h("h3", null, "蒸馏与召回参数"),
            h("span", { className: "sub" }, "阈值、预算与超时"),
          ),
          h("div", { className: "card-body" },
            h("div", { className: "form-grid" },
              NUMBERS.map(([path, label]) => h("div", { key: path, className: "field" },
                h("div", { className: "f-label" }, label),
                h("input", { type: "number", value: getIn(cfg, path) ?? "", onChange: (e) => setCfg((prev) => setIn(prev, path, Number(e.target.value))) }),
              )),
            ),
          ),
        ),
        h("div", { className: "hero", style: { marginTop: "16px" } },
          h("button", { className: btnPrimary, onClick: save }, "保存配置"),
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
      return h("div", { className: "chart-wrap" },
        h("svg", { viewBox: `0 0 ${W} ${H}`, style: { width: "100%", height: "auto" } },
          h("g", { stroke: "var(--dshm-border)", strokeWidth: "1" },
            h("line", { x1: "0", y1: "0", x2: W, y2: "0" }),
            h("line", { x1: "0", y1: H / 2, x2: W, y2: H / 2 }),
            h("line", { x1: "0", y1: H, x2: W, y2: H }),
          ),
          buckets.length === 1 ? byModel.map((p, i) => h("rect", {
            key: p.model, x: W / 2 - 12, y: H - Math.max(2, (p.points[0] / max) * (H - 14)), width: 24, height: Math.max(2, (p.points[0] / max) * (H - 14)), fill: MODEL_COLORS[i % MODEL_COLORS.length], opacity: 0.8,
          })) : byModel.map((p, i) => h("path", {
            key: p.model, d: line(p.points), fill: "none", stroke: MODEL_COLORS[i % MODEL_COLORS.length], strokeWidth: "1.8",
          })),
        ),
        h("div", { className: "legend" },
          byModel.map((p, i) => h("span", { key: p.model },
            h("span", { className: "sw", style: { background: MODEL_COLORS[i % MODEL_COLORS.length] } }), p.model)),
          h("span", { className: "spacer" }),
          h("span", null, buckets.length > 0 ? `${buckets[0]} ~ ${buckets[buckets.length - 1]}` : ""),
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
      return h("div", { className: "progress", style: { marginTop: "6px" } },
        h("div", { className: "bar", style: { width: `${pct}%` } }));
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
      const head0 = h("div", { className: "card-head" },
        h("h3", null, "记忆体检"),
        h("span", { className: "sub" }, "覆盖率、沉睡、近重复与召回质量"),
        h("span", { className: "spacer" }),
        note ? h("span", { className: "sub", style: { maxWidth: "300px" } }, note) : null,
        h("button", { className: "btn btn-sm", disabled: busy === "__auto" || running, onClick: autoMerge },
          busy === "__auto" ? "合并中…" : "自动合并"),
        h("button", { className: "btn btn-sm", disabled: busy === "__scenemerge" || running, onClick: sceneMerge },
          busy === "__scenemerge" ? "合并中…" : "合并同名场景"),
        h("button", { className: "btn btn-sm", disabled: busy === "__scenes" || running, onClick: startBuild },
          running ? "整合中…" : busy === "__scenes" ? "启动中…" : "整合场景积压"),
        h("button", { className: "btn btn-sm", disabled: busy === "__undo" || running, onClick: () => undoMerge(false) },
          busy === "__undo" ? "撤销中…" : "撤销上次合并"),
        h("button", { className: "btn btn-primary btn-sm", disabled: busy === "__audit", onClick: recheck },
          busy === "__audit" ? "体检中…" : "重新体检"));
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
        return h("div", { className: "card card-pad" }, head0, progressBlock,
          h("div", { className: "note", style: { marginTop: "8px" } }, "加载中…"));
      }
      const c = report.coverage || {};
      const head = report.head || {};
      const sleep = report.sleeping || {};
      const dup = report.duplicates || {};
      const sc = scenes || {};
      const len = report.length || {};
      const kinds = report.byKind || {};
      const zeroPct = c.total > 0 ? Math.round((c.zero / c.total) * 1000) / 10 : 0;
      const pendingCount = pending ? pending.chat + pending.work : null;
      return h("div", null,
        h("div", { className: "card" },
          head0,
          h("div", { className: "card-body", style: { paddingTop: "14px" } },
            progressBlock,
            h("div", { className: "grid grid-5", style: { marginTop: progressBlock ? "10px" : "0" } },
              stat("记忆总量", report.total == null ? "—" : report.total.toLocaleString(), `fact ${kinds.fact || 0} · opinion ${kinds.opinion || 0} · commitment ${kinds.commitment || 0}`),
              stat("召回覆盖率", c.hitPct != null ? `${c.hitPct}%` : "—", `命中 ≥10 次 ${head.manyHits ?? 0} 条`),
              stat("从未召回", c.zero == null ? "—" : c.zero.toLocaleString(), `占比 ${zeroPct}%`),
              stat("沉睡记忆", sleep.count == null ? "—" : sleep.count.toLocaleString(), `沉默口径 ${sleep.sleepDays ?? 14} 天`),
              stat("重量重组", dup.groupCount == null ? "—" : dup.groupCount, `待处理 ${dup.mergable ?? 0} 条`),
            ),
            h("div", { className: "grid grid-3", style: { marginTop: "12px" } },
              stat("可合并", dup.mergable == null ? "—" : dup.mergable, `近重复 ${dup.groupCount ?? 0} 组`),
              stat("场景", sc.total == null ? "—" : sc.total.toLocaleString(), `长度中位 ${len.median ?? "—"} · p90 ${len.p90 ?? "—"}`),
              stat("待整合", pendingCount == null ? "—" : pendingCount, "L0 对话排队中"),
            ),
          ),
        ),
        dup.groupCount > 0 ? h("div", { className: "grid grid-2", style: { marginTop: "12px" } },
          h("div", { className: "card" },
            h("div", { className: "card-head" },
              h("h3", null, "近重复组"),
              h("span", { className: "sub" }, `${dup.groupCount} 组 · 可合并 ${dup.mergable} 条`),
              h("span", { className: "spacer" }),
              h("button", { className: "btn btn-sm", onClick: () => setOpen(!open) }, open ? "收起" : "展开逐组合并"),
            ),
            h("div", { className: "card-body" },
              h("div", { className: "rows" }, (dup.groups || []).slice(0, open ? undefined : 6).map((g) => h("div", { key: g.keepId, className: "row" },
                h("div", { className: "left" },
                  h("div", { className: "r-top" },
                    tag(g.family === "work" ? "tag-amber" : "tag-blue", g.family === "work" ? "工作" : "个人"),
                    h("span", { className: "r-title" }, `${String(g.suggestedContent || "").slice(0, 60)}（${g.size} 条 → 1 条）`),
                  ),
                  h("div", { className: "r-sub" }, String(g.suggestedContent || "").slice(60, 180)),
                ),
                h("div", { className: "r-meta" },
                  h("b", null, `合并后召回 ${g.mergedHits}`),
                  h("button", { className: "btn btn-sm", style: { marginTop: "2px" }, disabled: busy === g.keepId, onClick: () => merge(g) },
                    busy === g.keepId ? "合并中…" : "合并这组"),
                ),
              ))),
              h("div", { className: "note" }, h("b", null, "合并不可逆"), "：只保留一条、hits 累加，但可一键撤销（上方「撤销上次合并」）。"),
            ),
          ),
          sleep.count > 0 ? h("div", { className: "card" },
            h("div", { className: "card-head" },
              h("h3", null, "沉睡记忆"),
              h("span", { className: "sub" }, `${sleep.count} 条 · 沉默口径 ${sleep.sleepDays ?? 14} 天`),
            ),
            h("div", { className: "card-body" },
              h("div", { className: "rows" }, (sleep.samples || []).map((item) => h("div", { key: item.id, className: "row" },
                h("div", { className: "left" },
                  h("div", { className: "r-top" },
                    tag(item.family === "work" ? "tag-amber" : "tag-blue", item.family === "work" ? "工作" : "个人"),
                    h("span", { className: "r-title" }, String(item.content || item.excerpt || "").slice(0, 50)),
                  ),
                  h("div", { className: "r-sub" }, String(item.content || item.excerpt || "").slice(50, 180)),
                ),
                h("div", { className: "r-meta" },
                  h("b", null, `沉睡 ${item.days || "?"} 天`),
                  h("button", { className: "btn btn-danger btn-sm", style: { marginTop: "2px" }, disabled: busy === item.id, onClick: () => dropSleeping(item) },
                    busy === item.id ? "删除中…" : "删除"),
                ),
              ))),
              h("div", { className: "note" }, h("b", null, "确认没用再删"), "，删除不可恢复。"),
            ),
          ) : null,
        ) : null,
        h("div", { className: "card", style: { marginTop: "12px" } },
          h("div", { className: "card-head" },
            h("h3", null, "召回质量测试卡"),
            h("span", { className: "sub" }, "抽旧记忆当考题"),
            h("span", { className: "spacer" }),
            test ? h("button", { className: "btn btn-sm", onClick: () => setTestOpen(!testOpen) }, testOpen ? "收起" : "看考题") : null,
            h("button", { className: "btn btn-primary btn-sm", disabled: busy === "__test", onClick: runRecallTest },
              busy === "__test" ? "测试中…" : test ? "再跑一次" : "跑测试卡"),
          ),
          h("div", { className: "card-body" },
            test ? h("div", { className: "metric-row" },
              h("div", { className: "m" }, h("b", null, `${test.score} / 100`), "得分"),
              h("div", { className: "m" }, h("b", null, test.hit), "命中"),
              h("div", { className: "m" }, h("b", null, test.half), "半对"),
              h("div", { className: "m" }, h("b", null, test.miss), "记错"),
              h("div", { className: "m" }, h("b", null, test.poolSize), "考题池"),
            ) : null,
            h("div", { className: "note" }, "只读不改记忆：给一半提示，看召回是否排前列。"),
            testOpen && test && test.items && test.items.length > 0 ? h("div", { className: "rows", style: { marginTop: "8px" } },
              (test.items || []).map((t) => h("div", { key: t.id, className: "row" },
                h("div", { className: "left" },
                  h("div", { className: "r-top" },
                    tag(t.verdict === "hit" ? "tag-green" : t.verdict === "half" ? "tag-amber" : "tag-rose", t.verdict === "hit" ? "命中" : t.verdict === "half" ? "半对" : "记错"),
                    h("span", { className: "r-title" }, `排第 ${t.rank || "—"} 名 · ${t.ageDays} 天前 · 族 ${t.family}`),
                  ),
                  h("div", { className: "r-sub" }, `提示：${t.hint}`),
                  h("div", { className: "r-sub", style: { color: C.muted } }, `答案：${String(t.answer || "").slice(0, 120)}`),
                  h("div", { className: "r-sub", style: { color: C.muted, fontSize: "11px" } },
                    `召回候选：${(t.candidates || []).map((c) => `#${c.id}(${c.score})`).join(" ") || "（无）"}`),
                ),
              ))) : null,
          ),
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
      const totalAdded = (data && data.byDay || []).reduce((s, d) => s + (d.added || 0), 0);
      const totalCalls = (data && data.byDay || []).reduce((s, d) => s + (d.calls || 0), 0);
      const recall = data && data.recall || {};
      return h("div", null,
        h("div", { className: "page-head" },
          h("h1", null, "洞察"),
          h("p", null, "覆盖率、沉睡、近重复与召回质量的体检看板"),
        ),
        h(HealthCard, null),
        h("div", { className: "grid grid-2", style: { marginTop: "12px" } },
          h("div", { className: "card" },
            h("div", { className: "card-head" },
              h("h3", null, "召回与会话"),
              h("span", { className: "sub" }, "注入统计"),
            ),
            h("div", { className: "card-body" },
              h("div", { className: "metric-row" },
                h("div", { className: "m" }, h("b", null, String(recall.recallInjections || 0)), "累计注入轮次"),
                h("div", { className: "m" }, h("b", null, String(recall.recallRecords || 0)), "累计注入记忆"),
                h("div", { className: "m" }, h("b", null, relTime(recall.lastRecallAt)), "最后注入"),
              ),
              data && data.sessionModes ? h("div", { className: "note" },
                `会话停用分布：暂停 ${data.sessionModes.off} · 只写 ${data.sessionModes.wo}`,
              ) : null,
            ),
          ),
          h("div", { className: "card" },
            h("div", { className: "card-head" },
              h("h3", null, "资产活动"),
              h("span", { className: "sub" }, "近 7 天新增与调用"),
            ),
            h("div", { className: "card-body" },
              h("div", { style: { display: "flex", alignItems: "flex-end", gap: "4px", height: "80px", marginTop: "10px" } },
                (data && data.byDay || []).map((d) => h("div", { key: d.day, style: { flex: 1, textAlign: "center" } },
                  h("div", { style: { height: `${Math.max(2, (d.outputTokens / maxDay) * 64)}px`, background: "var(--dshm-brand)", borderRadius: "3px 3px 0 0", opacity: 0.85 } }),
                  h("div", { style: { fontSize: "10px", color: "var(--dshm-text3)", marginTop: "2px" } }, d.day.slice(5)),
                )),
              ),
              h("div", { className: "metric-row", style: { marginTop: "8px" } },
                h("div", { className: "m" }, h("b", null, totalAdded), "新增记忆"),
                h("div", { className: "m" }, h("b", null, totalCalls), "蒸馏调用"),
              ),
            ),
          ),
        ),
        h("div", { className: "card", style: { marginTop: "12px" } },
          h("div", { className: "card-head" },
            h("h3", null, "蒸馏成本"),
            h("span", { className: "sub" }, `近 ${days} 天 · ${granularity === "day" ? "按天" : granularity === "week" ? "按周" : "按月"} · ${layer ? layer.toUpperCase() : "全部层级"}`),
            h("span", { className: "spacer" }),
            h("select", { className: "sel", style: { padding: "4px 9px" }, value: String(days), onChange: (e) => setDays(Number(e.target.value)) },
              [1, 7, 14, 30, 90, 365].map((d) => h("option", { key: d, value: d }, `近 ${d} 天`))),
            h("select", { className: "sel", style: { padding: "4px 9px" }, value: granularity, onChange: (e) => setGranularity(e.target.value) },
              h("option", { value: "day" }, "按天"), h("option", { value: "week" }, "按周"), h("option", { value: "month" }, "按月")),
            h("select", { className: "sel", style: { padding: "4px 9px" }, value: layer, onChange: (e) => setLayer(e.target.value) },
              h("option", { value: "" }, "全部层级"), h("option", { value: "l1" }, "L1 抽取"), h("option", { value: "l2" }, "L2 场景"), h("option", { value: "l3" }, "L3 画像")),
          ),
          h("div", { className: "card-body" },
            h("div", { className: "chart-wrap" }, h(TrendChart, { trend: data && data.trend })),
          ),
        ),
        h("div", { className: "card", style: { marginTop: "12px" } },
          h("div", { className: "card-head" },
            h("h3", null, "蒸馏调用明细"),
            h("span", { className: "sub" }, `近 ${days} 天 · 模型维度 · 失败与层级分布`),
          ),
          h("div", { className: "card-body", style: { padding: "0" } },
            !data || (data.byModel || []).length === 0
              ? h("div", { className: "note", style: { padding: "12px 20px" } }, "还没有蒸馏调用记录。")
              : h("table", { className: "rtable" },
                  h("tbody", null,
                    h("tr", null, ["模型", "调用", "失败", "输出 token", "思考 token", "均值", "中位数", "输入字符"].map((th) =>
                      h("th", { key: th }, th))),
                    data.byModel.map((m) => h("tr", { key: m.model },
                      h("td", { className: "mono" }, m.model),
                      h("td", null, m.calls),
                      h("td", { className: m.failures > 0 ? "fail" : "" }, m.failures),
                      h("td", null, fmtTokens(m.outputTokens)),
                      h("td", null, fmtTokens(m.reasoningTokens)),
                      h("td", null, fmtTokens(m.avgOutput)),
                      h("td", null, fmtTokens(m.medianOutput)),
                      h("td", null, fmtTokens(m.inChars)),
                    )),
                    (data && data.byLayer || []).length > 0 ? h("tr", { className: "sub" },
                      h("td", { colSpan: 8 }, `层级分布：${data.byLayer.map((l) => `${l.layer} ${l.calls} 次 / ${fmtTokens(l.outputTokens)}`).join(" · ")}`),
                    ) : null,
                    (data && data.failures || []).length > 0 ? h("tr", { className: "err" },
                      h("td", { colSpan: 8 }, "近期失败：" + data.failures.slice(0, 3).map((f) => `[${f.layer}] ${f.error || "unknown"}`).join("；")),
                    ) : null,
                  ),
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
      // 同步进度状态已提升到 MemoryWorkbench 顶层（切 tab 不丢），这里只保留面板本地 UI 状态
      const [proxyTest, setProxyTest] = useState(null); // { busy } 或 { ok, ms, error, kind, host, port }
      const [cronHint, setCronHint] = useState({});     // { upload: {at,text,error}, download: {at,text,error} } — cron 下次执行预览
      const cronTimer = useRef(null);                   // 防抖：输入暂停 300ms 才查一次
      const previewCron = (key, expr) => {
        const value = String(expr == null ? "" : expr).trim();
        if (!value) {
          setCronHint((prev) => ({ ...prev, [key]: null }));
          return;
        }
        if (cronTimer.current) clearTimeout(cronTimer.current);
        cronTimer.current = setTimeout(async () => {
          try {
            const d = await api("/api-memory/cron/next?expr=" + encodeURIComponent(value));
            setCronHint((prev) => ({ ...prev, [key]: d && d.ok ? { at: d.at, text: d.text } : { error: (d && d.error) || "查询失败" } }));
          } catch (e) {
            setCronHint((prev) => ({ ...prev, [key]: { error: e.message || String(e) } }));
          }
        }, 300);
      };
      const fmtClock = (ts) => {
        const d = new Date(ts);
        const p = (n) => String(n).padStart(2, "0");
        return `${d.getMonth() + 1}-${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
      };
      // 跨境拉 600KB 快照要二三十秒，没有可见进度用户会以为点了没反应；
      // 进度状态（syncBusy/syncStart/syncMsg）提升到 MemoryWorkbench 顶层，tick 定时器也在顶层跑，切 tab 不丢。
      const syncWaited = props.syncStart ? Math.max(0, Math.round((Date.now() - props.syncStart) / 1000)) : 0;
      const loadSync = useCallback(async () => {
        try { setSyncSt(await api("/api-memory/sync/status")); } catch { /* 忽略 */ }
      }, []);
      useEffect(() => { loadSync(); }, [loadSync]);
      const syncField = (key, label, placeholder, type) => {
        const isCron = key === "uploadCron" || key === "downloadCron";
        const hint = isCron ? cronHint[key] : null;
        return h("div", { style: { marginBottom: "8px" } },
          h("div", { style: { fontSize: "12px", color: C.muted, marginBottom: "3px" } }, label),
          h("input", {
            style: { ...input, width: "100%" }, placeholder, type: type || "text",
            value: (syncForm && syncForm[key]) || "",
            onChange: (e) => {
              const v = e.target.value;
              setSyncForm({ ...(syncForm || {}), [key]: v });
              if (isCron) previewCron(key, v);
            },
          }),
          isCron
            ? h("div", { style: { fontSize: "12px", marginTop: "3px" } },
                hint && hint.error
                  ? h("span", { style: { color: C.red } }, "✕ " + hint.error)
                  : hint && hint.at != null
                    ? h("span", { style: { color: C.green } },
                        `下次执行：${hint.text ? hint.text + " · " : ""}${fmtClock(hint.at)}`)
                    : hint
                      ? h("span", { style: { color: C.muted } }, "（表达式永不触发，检查日/月组合）")
                      : h("span", { style: { color: C.muted } }, "留空＝不自动"),
              )
            : null,
        );
      };
      const saveSyncCfg = async (thenUpload) => {
        try {
          const f = syncForm || {};
          // token 留空 = 保持原值（面板不回显 token，避免明文暴露在界面上）
          const patch = {
            enabled: f.enabled !== false,
            repo: String(f.repo || "").trim(),
            branch: String(f.branch || "main").trim(),
            deviceName: String(f.deviceName || "").trim(),
            includeL0: Boolean(f.includeL0),
            proxy: String(f.proxy || "").trim(),
            uploadCron: String(f.uploadCron || "").trim(),
            downloadCron: String(f.downloadCron || "").trim(),
          };
          if (String(f.token || "").trim()) patch.token = String(f.token).trim();
          await post("/api-memory/config", { sync: patch });
          setSyncForm(null);
          props.setSyncMsg({ kind: "ok", text: "同步配置已保存" });
          loadSync();
          if (thenUpload) await doUpload();
        } catch (e) { props.setSyncMsg({ kind: "err", text: "保存失败：" + (e.message || e) }); }
      };
      const testProxy = async () => {
        const proxy = String((syncForm && syncForm.proxy) || "").trim();
        if (!proxy) { setProxyTest({ ok: false, error: "请先填写代理地址" }); return; }
        setProxyTest({ busy: true });
        try {
          const d = await api("/api-memory/sync/test-proxy?proxy=" + encodeURIComponent(proxy));
          setProxyTest(d && d.ok
            ? { ok: true, ms: d.ms, kind: d.kind, host: d.host, port: d.port }
            : { ok: false, error: (d && d.error) || "测试失败", ms: d && d.ms });
        } catch (e) {
          setProxyTest({ ok: false, error: e.message || String(e) });
        }
      };
      const doUpload = async () => {
        props.setSyncBusy("upload");
        props.setSyncStart(Date.now());
        props.setSyncMsg(null);
        try {
          const d = await post("/api-memory/sync/upload", {});
          const m = d.mergeStats || {};
          const pulled = (m.recordsAdded || 0) + (m.scenesAdded || 0) + (m.biasesAdded || 0);
          const sha = String(d.commitSha || "").slice(0, 8);
          props.setSyncMsg({
            kind: pulled > 0 ? "ok" : "warn",
            text: pulled > 0
              ? `已上传 ${(d.bytes / 1024).toFixed(0)}KB · 顺带从远端并入 ${m.recordsAdded || 0} 条记忆、${m.scenesAdded || 0} 个场景 · 提交 ${sha}`
              : `已上传 ${(d.bytes / 1024).toFixed(0)}KB · 远端无新内容 · 提交 ${sha} · 本机已是最新`,
          });
          loadSync();
        } catch (e) { props.setSyncMsg({ kind: "err", text: "上传失败：" + (e.message || e) }); }
        props.setSyncBusy("");
        props.setSyncStart(0);
      };
      const doDownload = async () => {
        props.setSyncBusy("download");
        props.setSyncStart(Date.now());
        props.setSyncMsg(null);
        try {
          const d = await post("/api-memory/sync/download", {});
          const s = d.stats || {};
          const added = (s.recordsAdded || 0) + (s.scenesAdded || 0) + (s.biasesAdded || 0);
          const from = d.remoteDevice || "远端";
          const total = d.total && d.total.records != null ? ` · 现共 ${d.total.records} 条记忆` : "";
          if (d.skipped) {
            // 远端 digest 与上次一致，后端直接跳过下载（0.7 秒返回，不用等跨境传 600KB）
            props.setSyncMsg({ kind: "warn", text: `已是最新 · 远端「${from}」自上次同步后没有变化，本次未下载${total}` });
          } else {
            props.setSyncMsg({
              kind: added > 0 ? "ok" : "warn",
              text: added > 0
                ? `已从「${from}」同步 · 新增 ${s.recordsAdded || 0} 条记忆、${s.scenesAdded || 0} 个场景、${s.biasesAdded || 0} 条偏差${total} · 原数据已备份`
                : `已是最新 · 远端「${from}」与本机一致，没有新内容${total}`,
            });
          }
          loadSync();
        } catch (e) {
          const m = String((e && e.message) || e);
          props.setSyncMsg(e && e.empty
            ? { kind: "warn", text: m }
            : { kind: "err", text: "同步失败：" + m });
        }
        props.setSyncBusy("");
        props.setSyncStart(0);
      };
      const syncPanel = h("div", { className: "card" },
        h("div", { className: "card-head" },
          h("h3", null, "跨设备同步"),
          h("span", { className: "sub" }, "GitHub 快照 · 两台设备各装一份"),
        ),
        h("div", { className: "card-body" },
          h("div", { className: "note" },
            "平时只用一台：用完点「上传」，另一台点「同步」拉回来并合并。合并规则＝按 id 并集，同一条以更新时间晚的为准，召回次数取较大值（不累加，避免重复膨胀）。"),
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
            (syncSt.uploadCron || syncSt.downloadCron)
              ? h("div", { style: { color: C.muted, marginTop: "4px" } },
                  [
                    syncSt.uploadCron
                      ? `定时上传：${syncSt.nextUploadText || "按表达式"} · 下次 ${syncSt.nextUpload != null ? fmtClock(syncSt.nextUpload) : (syncSt.nextUploadError ? "✕ " + syncSt.nextUploadError : "（永不触发）")}`
                      : "",
                    syncSt.downloadCron
                      ? `定时同步：${syncSt.nextDownloadText || "按表达式"} · 下次 ${syncSt.nextDownload != null ? fmtClock(syncSt.nextDownload) : (syncSt.nextDownloadError ? "✕ " + syncSt.nextDownloadError : "（永不触发）")}`
                      : "",
                  ].filter(Boolean).join(" ｜ "),
                )
              : null,
          ) : null,
          syncForm ? h("div", { style: { marginBottom: "10px" } },
            syncField("repo", "GitHub 仓库（owner/repo）", "Hickey-Yuze/dsh-memory-sync"),
            syncField("token", "GitHub Token（细粒度，只给该仓库 contents 读写）", syncSt && syncSt.hasToken ? "已配置（留空＝不改）" : "github_pat_…", "password"),
            syncField("branch", "分支", "main"),
            syncField("deviceName", "本机名称（可留空，用主机名）", "Mac mini"),
            syncField("proxy", "代理地址（留空＝直连；如 socks5://127.0.0.1:10808 或 http://127.0.0.1:7890）", ""),
            syncField("uploadCron", "定时自动上传（cron，留空＝不自动；如 0 4 * * * 每天 04:00）", ""),
            syncField("downloadCron", "定时自动同步（cron，留空＝不自动；如 30 4 * * * 每天 04:30）", ""),
            h("div", { style: { display: "flex", gap: "8px", marginBottom: "8px", flexWrap: "wrap", alignItems: "center" } },
              h("button", { className: "btn btn-sm", disabled: proxyTest && proxyTest.busy, onClick: testProxy }, proxyTest && proxyTest.busy ? "测试中…" : "测试代理"),
              proxyTest && !proxyTest.busy ? h("span", { style: { fontSize: "12px", color: proxyTest.ok ? C.green : C.red, wordBreak: "break-all" } },
                proxyTest.ok
                  ? `✓ 代理可用（${proxyTest.kind}://${proxyTest.host}:${proxyTest.port}，${proxyTest.ms}ms）`
                  : `✕ ${proxyTest.error}${proxyTest.ms != null ? `（${proxyTest.ms}ms）` : ""}`,
              ) : null,
            ),
            h("label", { style: { display: "flex", alignItems: "center", gap: "6px", fontSize: "12.5px", marginBottom: "8px" } },
              h("input", { type: "checkbox", checked: Boolean(syncForm.includeL0), onChange: (e) => setSyncForm({ ...syncForm, includeL0: e.target.checked }) }),
              "连 L0 原始对话一起同步（体积 +2MB，一般不需要）",
            ),
            h("div", { style: { display: "flex", gap: "8px" } },
              h("button", { className: "btn btn-sm", onClick: () => saveSyncCfg(false) }, "保存配置"),
              h("button", { className: "btn btn-primary btn-sm", onClick: () => saveSyncCfg(true) }, "保存并上传"),
              h("button", { className: "btn btn-sm", onClick: () => setSyncForm(null) }, "取消"),
            ),
          ) : h("div", { className: "sync-acts" },
            h("button", { className: "btn btn-sm", onClick: () => setSyncForm({
              enabled: true, repo: (syncSt && syncSt.repo) || "", branch: (syncSt && syncSt.branch) || "main",
              token: "", deviceName: (syncSt && syncSt.deviceName) || "", includeL0: Boolean(syncSt && syncSt.includeL0),
              proxy: (syncSt && syncSt.proxy) || "",
              uploadCron: (syncSt && syncSt.uploadCron) || "",
              downloadCron: (syncSt && syncSt.downloadCron) || "",
            }) }, syncSt && syncSt.configured ? "修改配置" : "配置同步"),
            h("button", { className: "btn btn-sm", disabled: !syncSt || !syncSt.configured || syncBusy === "upload", onClick: doUpload }, syncBusy === "upload" ? "上传中…" : "上传到远端"),
            h("button", { className: "btn btn-sm", disabled: !syncSt || !syncSt.configured || syncBusy === "download", onClick: doDownload }, syncBusy === "download" ? "同步中…" : "从远端同步"),
            h("span", { style: { fontSize: "12px", color: C.muted } }, syncSt && syncSt.configured ? "" : "先配置仓库与 token"),
          ),
          syncBusy ? h("div", {
            className: "msg msg-busy",
          },
            h("span", { className: "icon" }, "⏳"),
            syncBusy === "download"
              ? `正在从远端下载快照并合并（快照约 2.8MB，走 codeload 归档通道，跨境网络一般 1–3 分钟）… 已等待 ${syncWaited} 秒，请不要关闭页面。`
              : `正在读取远端快照 → 合并本机 → 再上传（快照约 2.8MB，跨境一般 1–3 分钟；远端无变化时跳过下载秒传）… 已等待 ${syncWaited} 秒，请不要关闭页面。`,
          ) : null,
          syncMsg ? h("div", { className: "msg " + syncMsg.kind },
            h("span", { className: "icon" }, syncMsg.kind === "ok" ? "✓" : syncMsg.kind === "warn" ? "!" : "✕"),
            syncMsg.text,
          ) : null,
          syncSt ? h("div", { className: "note" },
            "不同步（各机本地）：" + (syncSt.localOnlyFiles || []).join("、"),
          ) : null,
        ),
      );
      // ---------- 版本更新（参照 cron-board：查 GitHub 最新 tag，一键 git pull） ----------
      const UPDATE_CMD = "cd ~/.dsh/plugins/dsh-memory && git pull";
      const [update, setUpdate] = useState(null); // { current, latest, hasUpdate, url } | null
      const [upd, setUpd] = useState(null); // applyUpdate 结果 | null
      const [updating, setUpdating] = useState(false);
      const [copied, setCopied] = useState(false);
      const [checking, setChecking] = useState(false); // 检查更新进行中（按钮反馈）
      const [checkErr, setCheckErr] = useState(""); // 检查失败原因（不再静默吞掉）
      const checkUpd = useCallback(async (force) => {
        setChecking(true);
        setCheckErr("");
        try {
          const d = await api("/api-memory/update/check" + (force ? "?force=1" : ""));
          if (d && d.value) setUpdate(d.value);
          else setCheckErr("版本检查无结果（无 release/tag 或网络不可用）");
        } catch (e) {
          setCheckErr(e.message || String(e));
        } finally {
          setChecking(false);
        }
      }, []);
      useEffect(() => { checkUpd(false); }, [checkUpd]);
      const runUpdate = async () => {
        if (updating) return;
        setUpdating(true);
        setUpd(null);
        try {
          const d = await post("/api-memory/update/apply", {});
          setUpd(d.value);
        } catch (e) {
          setUpd({ ok: false, changed: false, version: (update && update.current) || "", needRestart: false, stage: "pull", log: e.message || String(e) });
        }
        setUpdating(false);
      };
      const copyCmd = async () => {
        try {
          await navigator.clipboard.writeText(UPDATE_CMD);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch { /* 剪贴板不可用时静默 */ }
      };

      return h("div", null,
        h("div", { className: "page-head" },
          h("h1", null, "维护"),
          h("p", null, "版本、跨设备同步、重建与诊断"),
        ),
        h("div", { className: "card" },
          h("div", { className: "card-head" },
            h("h3", null, "版本更新"),
            h("span", { className: "sub" }, "GitHub 远端检查"),
            h("span", { className: "spacer" }),
            update && update.hasUpdate ? tag("tag-amber", `发现新版本 v${update.latest}`) : update && !update.hasUpdate ? tag("tag-green", "已是最新") : null,
            h("button", { className: "btn btn-sm", onClick: () => checkUpd(true), disabled: checking }, checking ? "检查中…" : "检查更新"),
          ),
          h("div", { className: "card-body" },
            checkErr
              ? h("div", { className: "note", style: { color: C.red } }, `检查失败：${checkErr}`)
              : null,
            h("div", { className: "metric-row" },
              h("div", { className: "m" }, h("b", null, update && update.current ? `v${update.current}` : "…"), "当前版本"),
              update && update.hasUpdate
                ? h("div", { className: "m" }, h("b", null, `v${update.latest}`), "最新版本")
                : null,
            ),
            update && update.hasUpdate
              ? h("div", null,
                  h("div", { className: "note" }, "在插件目录执行以下命令升级，然后重启 Harness 生效："),
                  h("code", { className: "code-block", style: { wordBreak: "break-all" } }, UPDATE_CMD),
                  h("div", { style: { display: "flex", gap: "8px" } },
                    h("button", { className: "btn btn-sm", onClick: copyCmd }, copied ? "已复制" : "复制命令"),
                    h("button", { className: "btn btn-primary btn-sm", onClick: runUpdate }, updating ? "更新中…" : "立即更新"),
                  ),
                  upd
                    ? h("div", { style: { marginTop: "8px", fontSize: "12.5px" } },
                        h("div", { style: { color: upd.ok ? C.green : C.red, fontWeight: 600 } },
                          upd.ok ? (upd.changed ? (upd.autoRestart ? "更新完成，正在重启 Harness…" : "更新完成") : "已是最新") : "更新失败"),
                        upd.ok && upd.changed && upd.autoRestart
                          ? h("div", { style: { fontSize: "12px", color: C.amber, marginTop: "4px" } }, "已自动重启，请稍候片刻。")
                          : upd.ok && upd.needRestart
                            ? h("div", { style: { fontSize: "12px", color: C.amber, marginTop: "4px" } }, "更新已拉取，请重启 Harness 生效。")
                            : null,
                        upd.log
                          ? h("pre", { className: "pre-scroll", style: { maxHeight: "160px" } }, upd.log)
                          : null,
                      )
                    : null,
                )
              : update === null
                ? h("div", { className: "note" }, "（版本检查不可用，可点「检查更新」重试）")
                : null,
          ),
        ),
        syncPanel,
        h("div", { className: "card" },
          h("div", { className: "card-head" },
            h("h3", null, "全量重建"),
            h("span", { className: "sub" }, "丢弃现有 L1–L3 资产，从 L0 会话事实源重新蒸馏"),
          ),
          h("div", { className: "card-body" },
            h("div", { className: "note" }, "L0 原始对话不受影响。"),
            rb && rb.phase === "running" ? h("div", null,
              h(ProgressBar, { pct: rb.total > 0 ? Math.round((rb.done / rb.total) * 100) : 0 }),
              h("div", { style: { display: "flex", gap: "8px", marginTop: "6px" } },
                h("span", { style: { fontSize: "13px" } }, `${rb.done}/${rb.total}`),
                h("button", { className: "btn btn-sm", onClick: async () => { await post("/api-memory/rebuild", { action: "cancel" }); loadStatus(); } }, "取消"),
              ),
            ) : h("div", null,
              confirming !== "rebuild"
                ? h("button", { className: "btn btn-danger btn-sm", onClick: () => setConfirming("rebuild") }, "全量重建…")
                : h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } },
                    h("span", { style: { fontSize: "13px", color: C.red } }, "确认重建？现有记忆资产将被清除后重新生成。"),
                    h("button", { className: "btn btn-danger btn-sm", onClick: startRebuild }, "确认"),
                    h("button", { className: "btn btn-sm", onClick: () => setConfirming("") }, "取消"),
                  ),
              rb && rb.phase !== "running" && rb.phase ? h("span", { className: "note", style: { marginLeft: "8px" } },
                `上次重建：${rb.phase}（${relTime(rb.endedAt)}）`) : null,
            ),
            msg ? h("div", { className: "note", style: { color: C.red } }, msg) : null,
          ),
        ),
        h("div", { className: "card" },
          h("div", { className: "card-head" },
            h("h3", null, "诊断日志"),
            h("span", { className: "sub" }, "info 级以上 · 最近 200 条"),
            h("span", { className: "spacer" }),
            h("button", { className: "btn btn-sm", onClick: loadLogs }, "刷新"),
          ),
          h("div", { className: "card-body" },
            h("div", { className: "logbox", style: { maxHeight: "260px" } },
              logs.length === 0 ? "（暂无日志）" : logs.join("\n"),
            ),
          ),
        ),
        h("div", { className: "card danger", style: { marginTop: "12px" } },
          h("div", { className: "card-head" },
            h("h3", null, "危险区"),
            h("span", { className: "sub" }, "不可恢复，请先备份"),
          ),
          h("div", { className: "card-body" },
            confirming !== "wipe"
              ? h("button", { className: "btn btn-danger", onClick: () => setConfirming("wipe") }, "清空记忆库…")
              : h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
                  h("span", { style: { fontSize: "13px", color: C.red } }, "将删除全部记忆资产（L0 会话保留）。再点一次连同 L0 一起删除。"),
                  h("button", { className: "btn btn-danger btn-sm", onClick: async () => { await post("/api-memory/wipe", { scope: "assets" }); setConfirming(""); setMsg("记忆资产已清空"); } }, "清空资产"),
                  h("button", { className: "btn btn-danger btn-sm", onClick: async () => { await post("/api-memory/wipe", { scope: "all" }); setConfirming(""); setMsg("记忆库已完全清空"); } }, "连 L0 一起删除"),
                  h("button", { className: "btn btn-sm", onClick: () => setConfirming("") }, "取消"),
                ),
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
        className: cx("chip-pill", !sid && "chip-disabled"),
        style: {
          display: "inline-flex", alignItems: "center", gap: "7px",
          opacity: !sid ? 0.5 : 1, cursor: !sid ? "default" : "pointer",
          borderColor: overridden || curFlow !== "follow" ? "var(--dshm-brand)" : "var(--dshm-border)",
        },
      },
        h("span", {
          className: cx("chip-dot", effective === "off" ? "red" : !overridden && curFlow === "follow" ? "gray" : ""),
          style: { background: dotColor },
        }),
        h("span", null, label),
        h("span", { style: { fontSize: "9px", color: "var(--dshm-text3)" } }, "▼"),
      );

      const modeRow = (value, labelText, desc) => h("div", {
        key: `m-${value || "global"}`,
        className: "mi",
        onClick: () => act({ mode: value || null }),
      },
        h("span", null, labelText),
        desc ? h("span", { className: "desc" }, desc) : null,
        (entry && entry.mode || null) === (value || null) ? h("span", { className: "ok" }, "✓") : null,
      );
      const flowRow = (value, labelText) => h("div", {
        key: `f-${value}`,
        className: "mi",
        onClick: () => act({ recall: value === "follow" ? null : value === "on" }),
      },
        h("span", null, labelText),
        curFlow === value ? h("span", { className: "ok" }, "✓") : null,
      );

      const menu = !open ? null : h("div", {
        ref: menuRef,
        className: "chip-menu",
        style: { left: pos.left, top: pos.top, background: opaqueBackdrop(anchorRef.current) },
      },
      h("div", { className: "mhead" },
        h("strong", null, "会话记忆"),
        h("span", { className: "desc" }, `默认档：${MODE_LABEL[info ? info.defaultMode : "auto"] || "auto"}`),
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
      err ? h("div", { className: "merr", style: { padding: "4px 14px", fontSize: "11px", color: C.red } }, err) : null,
      );

      return h("div", { style: { display: "inline-flex", position: "relative" } }, chip, menu);
    }

    // ---------- 主组件 ----------
    function MemoryWorkbench() {
      const [tab, setTab] = useState("overview");
      const [overview, setOverview] = useState(null);
      const [lastError, setLastError] = useState(null);
      // 跨设备同步进度提升到顶层：切 tab 不丢，任何 tab 都能看到上传/同步进度与结果
      const [syncBusy, setSyncBusy] = useState("");
      const [syncStart, setSyncStart] = useState(0);
      const [syncTick, setSyncTick] = useState(0);
      const [syncMsg, setSyncMsg] = useState(null);
      useEffect(() => {
        if (!syncBusy) return undefined;
        const t = setInterval(() => setSyncTick((n) => n + 1), 1000);
        return () => clearInterval(t);
      }, [syncBusy]);
      const syncWaited = syncStart ? Math.max(0, Math.round((Date.now() - syncStart) / 1000)) : 0;
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
      // 全局同步横幅：维护 tab 内已有内嵌进度块，其余 tab 用横幅展示（含结果，可关闭）
      const globalSyncBanner = tab !== "maintenance" && (syncBusy || syncMsg)
        ? h("div", { className: "mb" },
            syncBusy
              ? h("div", { className: "msg msg-busy" },
                  h("span", { className: "icon" }, "⏳"),
                  h("span", null, syncBusy === "download"
                    ? `正在从远端下载快照并合并（快照约 2.8MB，走 codeload 归档通道，跨境网络一般 1–3 分钟）… 已等待 ${syncWaited} 秒，请不要关闭页面。`
                    : `正在读取远端快照 → 合并本机 → 再上传（快照约 2.8MB，跨境一般 1–3 分钟；远端无变化时跳过下载秒传）… 已等待 ${syncWaited} 秒，请不要关闭页面。`),
                )
              : null,
            syncMsg && !syncBusy
              ? h("div", { className: "msg " + syncMsg.kind },
                  h("span", { className: "icon" }, syncMsg.kind === "ok" ? "✓" : syncMsg.kind === "warn" ? "!" : "✕"),
                  h("span", { style: { flex: 1 } }, syncMsg.text),
                  h("button", { className: "btn btn-sm", onClick: () => setSyncMsg(null) }, "关闭"),
                )
              : null,
          )
        : null;

      return h("div", { className: "dshm-root workbench", style: { minHeight: "300px" } },
        h("div", { className: "tabs", style: { position: "sticky", top: 0, zIndex: 2, background: "var(--dshm-surface)" } },
          TABS.map(([id, label]) => {
            const cnt = id === "library" && overview && overview.counts ? overview.counts.records : id === "bias" && overview && overview.counts ? overview.counts.biases : id === "insights" && overview && overview.counts ? overview.counts.scenes : null;
            return h("button", {
              key: id,
              className: cx("nav-item", tab === id && "on"),
              onClick: () => setTab(id),
            },
              h("span", null, label),
              cnt != null ? h("span", { className: "nav-count" }, cnt) : null,
            );
          }),
        ),
        globalSyncBanner,
        tab === "overview" ? h(OverviewTab, { data: overview, lastError, onJump: setTab }) : null,
        tab === "library" ? h(LibraryTab, null) : null,
        tab === "bias" ? h(BiasTab, null) : null,
        tab === "automation" ? h(AutomationTab, null) : null,
        tab === "insights" ? h(InsightsTab, null) : null,
        tab === "maintenance" ? h(MaintenanceTab, { onLastError: setLastError, syncBusy, setSyncBusy, syncStart, setSyncStart, syncMsg, setSyncMsg }) : null,
      );
    }

    // ---------- 挂载 ----------
    const inject = ["slots"];

    // UI_CSS 注入（幂等）：宿主环境组件用 className，样式必须真正进 DOM。
    let styleInjected = false;
    function injectStyle() {
      if (styleInjected || typeof document === "undefined") return;
      try {
        const el = document.createElement("style");
        el.setAttribute("data-dshm", "1");
        el.textContent = UI_CSS;
        (document.head || document.documentElement).appendChild(el);
        styleInjected = true;
      } catch (err) {
        console.error("[dsh-memory] style inject failed:", err);
      }
    }
    // 宿主可能用 data-theme / class 标记暗色主题，CSS 内 [data-theme="dark"] 覆盖变量。
    function detectHostTheme() {
      if (typeof document === "undefined") return "light";
      const el = document.documentElement;
      if (el && (el.getAttribute("data-theme") === "dark" || (el.className || "").includes("dark") || (el.className || "").includes("theme-dark"))) return "dark";
      if (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
      return "light";
    }
    function ThemeBridge() {
      const [theme, setTheme] = useState(detectHostTheme());
      useEffect(() => {
        injectStyle();
        const el = document.documentElement;
        const target = el || document.body;
        const apply = () => setTheme(detectHostTheme());
        const obs = typeof MutationObserver !== "undefined"
          ? new MutationObserver((muts) => { if (muts.some((m) => m.type === "attributes" && (m.attributeName === "class" || m.attributeName === "data-theme"))) apply(); })
          : null;
        if (obs && target) obs.observe(target, { attributes: true, attributeFilter: ["class", "data-theme"] });
        if (window.matchMedia) {
          const mq = window.matchMedia("(prefers-color-scheme: dark)");
          mq.addEventListener && mq.addEventListener("change", apply);
        }
        return () => { obs && obs.disconnect(); };
      }, []);
      return h("div", { className: "dshm-root", "data-theme": theme, style: { minHeight: "300px" } },
        h(MemoryWorkbench, null));
    }

    function apply(ctx) {
      try {
        injectStyle();
        ctx.slots.inject("settings.section", () => ctx.slots.register({
          name: "settings.section",
          id: "dsh-memory",
          order: 26,
          label: () => "记忆",
          inject: () => ({}),
        }, ThemeBridge));
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
