/**
 * dsh-github-installer — std browser facet (browser.ui.dsh/v1alpha1 LocalModule).
 *
 * The module is served by the adapter and materialized by the DSH client
 * module system. Activation negotiates the ContributionHost protocol and
 * registers a SettingsSection. The UI talks to the host through the
 * session-free same-origin HTTP API mounted by lib/index.js (the same
 * pattern dsh-market uses for its settings UI), so it works with zero
 * agent-session dependency.
 *
 * Why not executeCommand? The standard command channel executes against an
 * attached agent session (`executeCommand(contextId, line)` requires the
 * context to exist), and a SettingsSection has no session — so UI-driven
 * management actions go over the session-free HTTP bridge instead. If a
 * future host exposes a session to settings pages, the UI can migrate to
 * the command channel without protocol changes.
 */
window.__ModuleLoader__.load({
  id: "dsh-github-installer",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");

    const SETTINGS_SECTION = { apiVersion: "browser.ui.dsh/v1alpha1", kind: "SettingsSection" };
    const CONTRIBUTION_HOST = { apiVersion: "ui.dsh/v1alpha1", kind: "ContributionHost" };

    const API = {
      status: "/ghp-installer/status",
      list: "/ghp-installer/list",
      listFull: "/ghp-installer/list-full",
      check: "/ghp-installer/check-updates",
      install: "/ghp-installer/install",
      uninstall: "/ghp-installer/uninstall",
      update: "/ghp-installer/update",
      poll: "/ghp-installer/status-poll",
      cancel: "/ghp-installer/cancel",
    };

    async function getJson(path) {
      const res = await fetch(path, { credentials: "same-origin", cache: "no-store" });
      const text = await res.text();
      let data = null;
      try { data = text === "" ? null : JSON.parse(text); } catch (err) { data = null; }
      if (!res.ok && data === null) throw new Error("HTTP " + res.status);
      return data;
    }

    async function postJson(path, body) {
      const res = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let data = null;
      try { data = text === "" ? null : JSON.parse(text); } catch (err) { data = null; }
      if (!res.ok && data === null) throw new Error("HTTP " + res.status);
      return data;
    }

    const CSS = `
.ghp-card{display:flex;flex-direction:column;gap:14px;max-width:820px;padding:20px 2px}
.ghp-title{margin:0;font-size:20px;font-weight:600;line-height:30px}
.ghp-desc{margin:0;font-size:13px;line-height:21px;color:var(--dsw-alias-label-secondary,#8b93a1)}
.ghp-row{display:flex;gap:8px;align-items:center}
.ghp-input{flex:1;min-width:0;padding:9px 12px;border:1px solid var(--dsw-alias-border-l2,#d8dce3);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2328);font-size:13px;outline:none}
.ghp-input:focus{border-color:var(--dsw-alias-brand-primary,#4f6ef7)}
.ghp-btn{padding:9px 18px;border:none;border-radius:8px;background:var(--dsw-alias-brand-primary,#4f6ef7);color:var(--dsw-alias-label-primary-foreground,#fff);font-size:13px;font-weight:600;cursor:pointer}
.ghp-btn:disabled{opacity:.55;cursor:not-allowed}
.ghp-btn.ghp-ghost{background:transparent;border:1px solid var(--dsw-alias-border-l2,#d8dce3);color:var(--dsw-alias-label-secondary,#6b7280);font-weight:400}
.ghp-btn.ghp-danger{background:transparent;border:1px solid rgba(239,68,68,.4);color:var(--dsw-alias-state-error-primary,#ef4444);font-weight:400}
.ghp-btn.ghp-update{background:rgba(79,111,247,.1);border:1px solid rgba(79,111,247,.4);color:var(--dsw-alias-brand-primary,#4f6ef7);font-weight:500}
.ghp-status{display:flex;flex-wrap:wrap;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280)}
.ghp-pill{padding:3px 10px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,#f2f3f5);border:1px solid var(--dsw-alias-border-l2,#e5e7eb)}
.ghp-pill.ghp-on{background:rgba(79,111,247,.1);border-color:rgba(79,111,247,.35);color:var(--dsw-alias-brand-primary,#4f6ef7)}
.ghp-log{max-height:200px;overflow:auto;margin:0;padding:10px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,#f2f3f5);border:1px solid var(--dsw-alias-border-l2,#e5e7eb);font:11px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;word-break:break-all;color:var(--dsw-alias-label-secondary,#6b7280)}
.ghp-result{margin:0;padding:12px 14px;border-radius:8px;font-size:13px;line-height:22px;white-space:pre-wrap;word-break:break-word}
.ghp-ok{background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.3)}
.ghp-err{background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.3);color:var(--dsw-alias-label-primary,#1f2328)}
.ghp-check{margin:0;padding:9px 12px;border-radius:8px;font-size:12px;line-height:19px;white-space:pre-wrap;word-break:break-word}
.ghp-check-info{background:rgba(79,111,247,.08);border:1px solid rgba(79,111,247,.3);color:var(--dsw-alias-label-primary,#1f2328)}
.ghp-empty{color:var(--dsw-alias-label-tertiary,#8b93a1);font-size:13px;padding:16px 4px}
.ghp-toolbar{display:flex;align-items:center;gap:8px;justify-content:space-between;width:100%}
.ghp-toolbar-left{display:flex;align-items:center;gap:10px}
.ghp-toolbar-title{display:flex;align-items:baseline;gap:8px}
.ghp-count{color:var(--dsw-alias-label-tertiary,#8b93a1);font-size:12px;font-weight:400}
.ghp-view-toggle{display:flex;border:1px solid var(--dsw-alias-border-l2,#d8dce3);border-radius:8px;overflow:hidden}
.ghp-view-btn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:26px;border:none;background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);cursor:pointer;padding:0}
.ghp-view-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#f2f3f5)}
.ghp-view-btn.ghp-on{background:var(--dsw-alias-bg-layer-2,#f2f3f5);color:var(--dsw-alias-label-primary,#1f2328)}
.ghp-list{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:10px;overflow:hidden}
.ghp-item{display:flex;align-items:center;gap:12px;padding:11px 14px;border-bottom:1px solid var(--dsw-alias-border-l2,#e5e7eb);font-size:13px}
.ghp-item:last-child{border-bottom:none}
.ghp-avatar{width:40px;height:40px;border-radius:8px;object-fit:cover;flex-shrink:0;border:1px solid var(--dsw-alias-border-l2,#e5e7eb)}
.ghp-avatar-ph{display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-layer-2,#f2f3f5);color:var(--dsw-alias-brand-primary,#4f6ef7);font-size:18px;font-weight:700}
.ghp-item-main{flex:1;min-width:0}
.ghp-item-name{font-weight:600;color:var(--dsw-alias-label-primary,#1f2328);overflow-wrap:anywhere;text-decoration:none}
.ghp-item-name:hover{text-decoration:underline}
.ghp-item-meta{color:var(--dsw-alias-label-tertiary,#8b93a1);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.ghp-item-desc{margin:2px 0 0;color:var(--dsw-alias-label-secondary,#6b7280);font-size:12px;line-height:18px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.ghp-item-badges{display:flex;gap:4px;margin-top:3px;flex-wrap:wrap}
.ghp-badge{font-size:10px;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,#f2f3f5);border:1px solid var(--dsw-alias-border-l2,#e5e7eb);color:var(--dsw-alias-label-tertiary,#8b93a1)}
.ghp-badge.ghp-up{background:rgba(79,111,247,.1);border-color:rgba(79,111,247,.35);color:var(--dsw-alias-brand-primary,#4f6ef7)}
.ghp-item-stars{color:#d97706;font-size:12px;white-space:nowrap}
.ghp-item-actions{display:flex;gap:6px;flex-shrink:0}
.ghp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.ghp-grid-card{display:flex;flex-direction:column;gap:8px;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:12px;padding:14px;background:var(--dsw-alias-bg-layer-1,#fff)}
.ghp-grid-head{display:flex;gap:10px;align-items:flex-start}
.ghp-grid-card .ghp-avatar{width:46px;height:46px;border-radius:10px}
.ghp-grid-name{font-weight:600;font-size:14px;color:var(--dsw-alias-label-primary,#1f2328);overflow-wrap:anywhere;text-decoration:none;line-height:20px}
.ghp-grid-name:hover{text-decoration:underline}
.ghp-grid-version{color:var(--dsw-alias-label-tertiary,#8b93a1);font-size:11px;line-height:16px;overflow-wrap:anywhere}
.ghp-grid-desc{margin:0;color:var(--dsw-alias-label-secondary,#6b7280);font-size:12px;line-height:18px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;flex:1}
.ghp-grid-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:6px}
.ghp-grid-badges{display:flex;gap:4px;flex-wrap:wrap}
.ghp-grid-actions{display:flex;gap:6px;flex-shrink:0}
`;
    const CSS_TAG = "ghp-installer/installer.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_TAG) + "]") === null) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-github-installer";
      tag.dataset.pluginCss = CSS_TAG;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    // Windows-style view-mode icons (inline SVG).
    const ICON_LIST = React.createElement("svg", { width: 14, height: 14, viewBox: "0 0 16 16", fill: "currentColor", "aria-hidden": "true" },
      React.createElement("path", { d: "M2 3h12v1.8H2zM2 7.1h12v1.8H2zM2 11.2h12V13H2z" }));
    const ICON_GRID = React.createElement("svg", { width: 14, height: 14, viewBox: "0 0 16 16", fill: "currentColor", "aria-hidden": "true" },
      React.createElement("path", { d: "M1.6 1.6h5.2v5.2H1.6zM9.2 1.6h5.2v5.2H9.2zM1.6 9.2h5.2v5.2H1.6zM9.2 9.2h5.2v5.2H9.2z" }));

    function Avatar(props) {
      const row = props.row;
      const [failed, setFailed] = React.useState(false);
      const src = row.image && !failed ? row.image : null;
      if (src === null) {
        return React.createElement("div", { className: "ghp-avatar ghp-avatar-ph" },
          (row.name && row.name.length > 0 ? row.name[0] : "?").toUpperCase());
      }
      return React.createElement("img", {
        className: "ghp-avatar",
        src: src,
        alt: row.name,
        loading: "lazy",
        onError: function () { setFailed(true); },
      });
    }

    function InstallerSection() {
      const [status, setStatus] = React.useState(null);
      const [list, setList] = React.useState(null);
      const [fullMap, setFullMap] = React.useState({});
      const [viewMode, setViewMode] = React.useState(function () {
        try { return localStorage.getItem("ghp:viewMode") === "grid" ? "grid" : "row"; }
        catch (err) { return "row"; }
      });
      const [url, setUrl] = React.useState("");
      const [phase, setPhase] = React.useState("idle");
      const [busy, setBusy] = React.useState(false);
      const [checking, setChecking] = React.useState(false);
      const [checkMsg, setCheckMsg] = React.useState(null);
      const [lines, setLines] = React.useState([]);
      const [result, setResult] = React.useState(null);
      const pollRef = React.useRef(null);

      const loadFull = function (force) {
        return getJson(API.listFull + (force ? "?force=1" : ""))
          .then(function (full) {
            if (full !== null && full.ok === true && Array.isArray(full.rows)) {
              const map = {};
              for (const row of full.rows) map[row.name] = row;
              setFullMap(map);
            }
            return full;
          })
          .catch(function (err) { return { ok: false, error: String(err) }; });
      };

      React.useEffect(function () {
        let disposed = false;
        getJson(API.status)
          .then(function (s) { if (!disposed) setStatus(s); })
          .catch(function (err) { if (!disposed) setStatus({ ok: false, error: String(err) }); });
        getJson(API.list)
          .then(function (l) { if (!disposed) setList(l); })
          .catch(function (err) { if (!disposed) setList({ ok: false, error: String(err) }); });
        loadFull(false).then(function (full) {
          if (disposed || full === null || full.ok !== true || !Array.isArray(full.rows)) return;
          setList({ ok: true, rows: full.rows.map(function (row) {
            return { name: row.name, spec: row.spec, version: row.version, protected: row.protected, hasBundle: row.hasBundle, hasClient: row.hasClient };
          }) });
        });
        return function () { disposed = true; };
      }, []);

      const stopPoll = function () {
        if (pollRef.current !== null) { clearTimeout(pollRef.current); pollRef.current = null; }
      };
      const poll = async function () {
        try {
          const st = await getJson(API.poll);
          const op = st !== null && st.operation ? st.operation : {};
          if (Array.isArray(op.lines)) setLines(op.lines);
          if (st !== null && !st.running) {
            setPhase(op.result && op.result.ok === true ? "done" : "error");
            setResult(op.result);
            setBusy(false);
            return;
          }
          pollRef.current = setTimeout(poll, 900);
        } catch (err) {
          setPhase("error");
          setResult({ ok: false, error: String(err) });
          setBusy(false);
        }
      };
      React.useEffect(function () {
        if (phase !== "running") return;
        pollRef.current = setTimeout(poll, 900);
        return stopPoll;
      }, [phase]);

      const startAction = async function (path, body) {
        if (busy) return;
        setBusy(true);
        setResult(null);
        setLines([]);
        try {
          const started = await postJson(path, body);
          if (started !== null && started.ok === true && started.started === true) {
            setPhase("running");
            return;
          }
          setPhase("error");
          setResult(started || { ok: false, error: "无响应" });
          setBusy(false);
        } catch (err) {
          setPhase("error");
          setResult({ ok: false, error: String(err) });
          setBusy(false);
        }
      };

      const onInstall = function () { void startAction(API.install, { url: url }); };
      const onRefresh = function () {
        setList(null);
        getJson(API.list).then(function (l) { setList(l); }).catch(function () {});
        void loadFull(true);
      };
      const onCheckUpdates = async function () {
        if (checking) return;
        setChecking(true);
        setCheckMsg(null);
        try {
          const res = await getJson(API.check);
          if (res !== null && res.ok === true) {
            if (Array.isArray(res.rows)) {
              const map = {};
              for (const row of res.rows) map[row.name] = row;
              setFullMap(map);
            }
            if (res.count > 0) {
              setCheckMsg({ kind: "info", text: "发现 " + res.count + " 个插件有更新：" + (res.names || []).join(", ") + "（点击「更新」升级）" });
            } else {
              setCheckMsg({ kind: "ok", text: "所有插件都是最新版本" });
            }
          } else {
            setCheckMsg({ kind: "err", text: "检查更新失败：" + String(res !== null && res.error ? res.error : "无响应") });
          }
        } catch (err) {
          setCheckMsg({ kind: "err", text: "检查更新失败：" + String(err) });
        } finally {
          setChecking(false);
        }
      };
      const toggleView = function (mode) {
        setViewMode(mode);
        try { localStorage.setItem("ghp:viewMode", mode); } catch (err) { /* ignore */ }
      };

      const statusNode = status === null
        ? React.createElement("div", { className: "ghp-status" }, "状态加载中…")
        : status.ok !== true
          ? React.createElement("div", { className: "ghp-status" }, "状态不可用：" + String(status.error || "未知"))
          : React.createElement("div", { className: "ghp-status" },
              React.createElement("span", { className: "ghp-pill" }, "配置: " + status.profile.name),
              React.createElement("span", { className: status.adapterInstalled ? "ghp-pill ghp-on" : "ghp-pill" },
                status.adapterInstalled
                  ? "dsh-std 适配器已就绪 (" + status.adapterSpec + ")"
                  : "dsh-std 适配器未安装（std 插件需要 @dsh-std/adapter-dsh）"));

      const logNode = phase === "running"
        ? React.createElement("pre", { className: "ghp-log" }, lines.join(""))
        : null;

      let resultNode = null;
      if (result !== null) {
        if (result.ok === true) {
          const parts = [];
          if (Array.isArray(result.added)) {
            for (const p of result.added) {
              let line = "✓ " + p.name + (p.version !== null ? "@" + p.version : "");
              if (p.shape === "both") line += "  [双通道: bundle+std]";
              else if (p.hasBundle) line += "  [宿主端 bundle]";
              else if (p.stdComponent) line += "  [DSH 标准组件]";
              if (p.stdManifestId) line += "  (std id: " + p.stdManifestId + ")";
              if (p.hasClient) line += "  [客户端]";
              if (p.stdDeps && p.stdDeps.length > 0) line += "  [dsh-std 协议]";
              parts.push(line);
            }
          } else if (Array.isArray(result.removed)) {
            for (const name of result.removed) parts.push("✓ 已卸载 " + name);
          } else if (Array.isArray(result.updated)) {
            for (const name of result.updated) parts.push("✓ 已更新 " + name + (result.version ? " @" + result.version : ""));
          }
          if (result.stdPlugin && !result.adapterInstalled) parts.push("⚠ 该插件基于 dsh-std 协议，但 @dsh-std/adapter-dsh 未安装——请先安装适配器");
          if (typeof result.hint === "string") parts.push("→ " + result.hint);
          resultNode = React.createElement("div", { className: "ghp-result ghp-ok" }, parts.join("\n"));
        } else {
          const text = result.error !== undefined ? result.error : "操作失败 (exit " + String(result.exitCode) + ")";
          const tail = result.stderrTail !== undefined && result.stderrTail !== "" ? "\n\n" + String(result.stderrTail).slice(-1500) : "";
          resultNode = React.createElement("div", { className: "ghp-result ghp-err" }, text + tail);
        }
      }

      // Merge base rows with enriched metadata.
      const rows = list !== null && list.ok === true && Array.isArray(list.rows)
        ? list.rows.map(function (row) {
            const meta = fullMap[row.name] || {};
            return Object.assign({}, row, meta);
          })
        : [];

      const badgesFor = function (row) {
        const badges = [];
        if (row.shape === "both") {
          badges.push(React.createElement("span", { key: "b", className: "ghp-badge" }, "bundle+std"));
        } else {
          if (row.hasBundle) badges.push(React.createElement("span", { key: "b", className: "ghp-badge" }, "bundle"));
          if (row.stdComponent) badges.push(React.createElement("span", { key: "s", className: "ghp-badge" }, "std"));
        }
        if (row.hasClient) badges.push(React.createElement("span", { key: "c", className: "ghp-badge" }, "client"));
        if (row.protected) badges.push(React.createElement("span", { key: "p", className: "ghp-badge" }, "保护"));
        if (row.updateAvailable) badges.push(React.createElement("span", { key: "u", className: "ghp-badge ghp-up" }, "有更新"));
        return badges;
      };
      const updateLabel = function (row) {
        if (!row.updateAvailable) return "更新";
        return "更新 " + String(row.updateCurrent || "?") + "→" + String(row.updateNext || "?");
      };
      const nameLink = function (row, className) {
        const label = row.name;
        if (row.homepage) {
          return React.createElement("a", { className: className, href: row.homepage, target: "_blank", rel: "noopener noreferrer" }, label);
        }
        return React.createElement("span", { className: className }, label);
      };
      const actionsFor = function (row) {
        if (row.protected) return null;
        const actions = [];
        if (row.updateAvailable) {
          actions.push(React.createElement("button", {
            key: "up",
            className: "ghp-btn ghp-update",
            disabled: busy,
            onClick: function () { void startAction(API.update, { name: row.name }); },
          }, updateLabel(row)));
        }
        actions.push(React.createElement("button", {
          key: "rm",
          className: "ghp-btn ghp-danger",
          disabled: busy,
          onClick: function () { void startAction(API.uninstall, { name: row.name }); },
        }, "卸载"));
        return React.createElement("div", { className: "ghp-item-actions" }, actions);
      };
      const starsNode = function (row) {
        return row.stars !== null && row.stars !== undefined
          ? React.createElement("span", { className: "ghp-item-stars" }, "★ " + row.stars)
          : null;
      };

      let listNode = null;
      if (list === null) {
        listNode = React.createElement("div", { className: "ghp-empty" }, "列表加载中…");
      } else if (list.ok !== true) {
        listNode = React.createElement("div", { className: "ghp-empty" }, "列表不可用：" + String(list.error || "未知"));
      } else if (rows.length === 0) {
        listNode = React.createElement("div", { className: "ghp-empty" }, "没有已安装的插件");
      } else if (viewMode === "grid") {
        listNode = React.createElement("div", { className: "ghp-grid" },
          rows.map(function (row) {
            return React.createElement("div", { key: row.name, className: "ghp-grid-card" },
              React.createElement("div", { className: "ghp-grid-head" },
                React.createElement(Avatar, { row: row }),
                React.createElement("div", { style: { minWidth: 0, flex: 1 } },
                  nameLink(row, "ghp-grid-name"),
                  React.createElement("div", { className: "ghp-grid-version" },
                    (row.version ? row.version + " · " : "") + row.spec))),
              React.createElement("p", { className: "ghp-grid-desc" }, row.description || ""),
              React.createElement("div", { className: "ghp-grid-foot" },
                React.createElement("div", { className: "ghp-grid-badges" },
                  badgesFor(row),
                  starsNode(row)),
                row.protected ? null
                  : React.createElement("div", { className: "ghp-grid-actions" },
                      row.updateAvailable
                        ? React.createElement("button", {
                            key: "up",
                            className: "ghp-btn ghp-update",
                            disabled: busy,
                            onClick: function () { void startAction(API.update, { name: row.name }); },
                          }, updateLabel(row))
                        : null,
                      React.createElement("button", {
                        key: "rm",
                        className: "ghp-btn ghp-danger",
                        disabled: busy,
                        onClick: function () { void startAction(API.uninstall, { name: row.name }); },
                      }, "卸载"))));
          }));
      } else {
        listNode = React.createElement("div", { className: "ghp-list" },
          rows.map(function (row) {
            return React.createElement("div", { key: row.name, className: "ghp-item" },
              React.createElement(Avatar, { row: row }),
              React.createElement("div", { className: "ghp-item-main" },
                React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
                  nameLink(row, "ghp-item-name"),
                  starsNode(row)),
                React.createElement("div", { className: "ghp-item-meta" },
                  (row.version ? row.version + " · " : "") + row.spec),
                row.description
                  ? React.createElement("p", { className: "ghp-item-desc" }, row.description)
                  : null,
                badgesFor(row).length > 0
                  ? React.createElement("div", { className: "ghp-item-badges" }, badgesFor(row))
                  : null),
              actionsFor(row));
          }));
      }

      const viewToggle = React.createElement("div", { className: "ghp-view-toggle" },
        React.createElement("button", {
          className: "ghp-view-btn" + (viewMode === "row" ? " ghp-on" : ""),
          title: "行状列表",
          onClick: function () { toggleView("row"); },
        }, ICON_LIST),
        React.createElement("button", {
          className: "ghp-view-btn" + (viewMode === "grid" ? " ghp-on" : ""),
          title: "图状网格",
          onClick: function () { toggleView("grid"); },
        }, ICON_GRID));

      return React.createElement("div", { className: "ghp-card" },
        React.createElement("h3", { className: "ghp-title" }, "插件安装 / 卸载 / 更新"),
        React.createElement("p", { className: "ghp-desc" },
          "粘贴 GitHub 仓库网址、npm 包名或 Git 仓库地址即可安装（标准 dsh plugin add github:… 协议，与 dsh-market 相同）。支持 monorepo 子目录 /tree/<分支>/<子目录>。"),
        statusNode,
        React.createElement("div", { className: "ghp-row" },
          React.createElement("input", {
            className: "ghp-input",
            value: url,
            placeholder: "https://github.com/owner/repo 或 npm 包名",
            disabled: busy,
            onChange: function (e) { setUrl(e.target.value); },
            onKeyDown: function (e) { if (e.key === "Enter" && !busy && url.trim() !== "") onInstall(); },
          }),
          React.createElement("button", {
            className: "ghp-btn",
            onClick: onInstall,
            disabled: busy || url.trim() === "",
          }, busy ? (phase === "running" ? "进行中…" : "处理中…") : "安装"),
          phase === "running"
            ? React.createElement("button", {
                className: "ghp-btn ghp-ghost",
                onClick: function () { void postJson(API.cancel, {}).catch(function () {}); },
              }, "取消")
            : null),
        logNode,
        resultNode,
        checkMsg !== null
          ? React.createElement("p", { className: "ghp-check " + (checkMsg.kind === "err" ? "ghp-err" : checkMsg.kind === "ok" ? "ghp-ok" : "ghp-check-info") }, checkMsg.text)
          : null,
        React.createElement("div", { className: "ghp-toolbar" },
          React.createElement("div", { className: "ghp-toolbar-left" },
            React.createElement("div", { className: "ghp-toolbar-title" },
              React.createElement("h3", { className: "ghp-title" }, "已安装插件"),
              list !== null && list.ok === true && Array.isArray(list.rows)
                ? React.createElement("span", { className: "ghp-count" }, "共 " + list.rows.length + " 个")
                : null),
            viewToggle),
          React.createElement("div", { className: "ghp-row", style: { gap: "6px" } },
            React.createElement("button", { className: "ghp-btn ghp-ghost", onClick: onCheckUpdates, disabled: checking }, checking ? "检查中…" : "检查更新"),
            React.createElement("button", { className: "ghp-btn ghp-ghost", onClick: onRefresh }, "刷新"))),
        listNode);
    }

    // -----------------------------------------------------------------------
    // FacetModule: negotiate ContributionHost and register the SettingsSection.
    // -----------------------------------------------------------------------
    const facet = {
      async activate(context) {
        const host = context.protocols.client(CONTRIBUTION_HOST);
        if (host === undefined || typeof host.register !== "function") {
          throw new Error("ghp-installer: ContributionHost 未协商成功");
        }
        const lease = host.register({
          descriptor: {
            id: "ghp-installer",
            surface: SETTINGS_SECTION,
            content: { label: "插件安装", order: 40 },
          },
          localModule: {
            component: InstallerSection,
            // No executeCommand/readAttachment injection on purpose: the std
            // command channel needs an attached agent session (unavailable in
            // a SettingsSection), so every UI interaction goes through the
            // session-free same-origin HTTP API mounted by lib/index.js.
          },
        });
        context.scope.add(function () { return lease.dispose(); });
      },
      deactivate(reason) {
        // All contributions are revoked by the cleanup scope on deactivation.
      },
      snapshot() {
        return {
          state: "active",
          message: "dsh-github-installer: SettingsSection 插件安装（browser.ui.dsh/v1alpha1，HTTP 通道）",
          extensions: [
            {
              apiVersion: SETTINGS_SECTION.apiVersion,
              kind: SETTINGS_SECTION.kind,
              name: "ghp-installer",
              status: { state: "available" },
            },
          ],
        };
      },
    };

    exports.default = facet;
    exports.facet = facet;
    return module.exports;
  },
});
