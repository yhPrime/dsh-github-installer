/**
 * dsh-github-installer — std browser facet (browser.ui.dsh/v1alpha1 LocalModule).
 *
 * The module is served by the adapter and materialized by the DSH client
 * module system, so it registers a factory under the package name and exports
 * a FacetModule as `default`. Activation negotiates the ContributionHost
 * protocol and registers a SettingsSection contribution; the UI drives the
 * host through the standard command host (executeCommand).
 */
window.__ModuleLoader__.load({
  id: "dsh-github-installer",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");

    const SETTINGS_SECTION = { apiVersion: "browser.ui.dsh/v1alpha1", kind: "SettingsSection" };
    const CONTRIBUTION_HOST = { apiVersion: "ui.dsh/v1alpha1", kind: "ContributionHost" };

    const CSS = `
.ghp-card{display:flex;flex-direction:column;gap:14px;max-width:760px;padding:20px 2px}
.ghp-title{margin:0;font-size:20px;font-weight:600;line-height:30px}
.ghp-desc{margin:0;font-size:13px;line-height:21px;color:var(--dsw-alias-label-secondary,#8b93a1)}
.ghp-banner{margin:0;padding:10px 12px;border-radius:8px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.3);font-size:12px;line-height:19px;color:var(--dsw-alias-label-primary,#1f2328)}
.ghp-row{display:flex;gap:8px}
.ghp-input{flex:1;min-width:0;padding:9px 12px;border:1px solid var(--dsw-alias-border-l2,#d8dce3);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2328);font-size:13px;outline:none}
.ghp-input:focus{border-color:var(--dsw-alias-brand-primary,#4f6ef7)}
.ghp-btn{padding:9px 18px;border:none;border-radius:8px;background:var(--dsw-alias-brand-primary,#4f6ef7);color:var(--dsw-alias-label-primary-foreground,#fff);font-size:13px;font-weight:600;cursor:pointer}
.ghp-btn:disabled{opacity:.55;cursor:not-allowed}
.ghp-btn.ghp-ghost{background:transparent;border:1px solid var(--dsw-alias-border-l2,#d8dce3);color:var(--dsw-alias-label-secondary,#6b7280);font-weight:400}
.ghp-btn.ghp-danger{background:transparent;border:1px solid rgba(239,68,68,.4);color:var(--dsw-alias-state-error-primary,#ef4444);font-weight:400}
.ghp-status{display:flex;flex-wrap:wrap;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280)}
.ghp-pill{padding:3px 10px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,#f2f3f5);border:1px solid var(--dsw-alias-border-l2,#e5e7eb)}
.ghp-pill.ghp-on{background:rgba(79,111,247,.1);border-color:rgba(79,111,247,.35);color:var(--dsw-alias-brand-primary,#4f6ef7)}
.ghp-log{max-height:200px;overflow:auto;margin:0;padding:10px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,#f2f3f5);border:1px solid var(--dsw-alias-border-l2,#e5e7eb);font:11px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;word-break:break-all;color:var(--dsw-alias-label-secondary,#6b7280)}
.ghp-result{margin:0;padding:12px 14px;border-radius:8px;font-size:13px;line-height:22px;white-space:pre-wrap;word-break:break-word}
.ghp-ok{background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.3)}
.ghp-err{background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.3);color:var(--dsw-alias-label-primary,#1f2328)}
.ghp-list{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:10px;overflow:hidden}
.ghp-item{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l2,#e5e7eb);font-size:13px}
.ghp-item:last-child{border-bottom:none}
.ghp-item-main{flex:1;min-width:0}
.ghp-item-name{font-weight:600;color:var(--dsw-alias-label-primary,#1f2328);overflow-wrap:anywhere}
.ghp-item-meta{color:var(--dsw-alias-label-tertiary,#8b93a1);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.ghp-item-badges{display:flex;gap:4px;margin-top:2px}
.ghp-badge{font-size:10px;padding:1px 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,#f2f3f5);border:1px solid var(--dsw-alias-border-l2,#e5e7eb);color:var(--dsw-alias-label-tertiary,#8b93a1)}
.ghp-item-actions{display:flex;gap:6px;flex-shrink:0}
.ghp-empty{color:var(--dsw-alias-label-tertiary,#8b93a1);font-size:13px;padding:16px 4px}
`;
    const CSS_TAG = "ghp-installer/installer.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_TAG) + "]") === null) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-github-installer";
      tag.dataset.pluginCss = CSS_TAG;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    function InstallerSection(props) {
      const executeCommand = props && typeof props.executeCommand === "function" ? props.executeCommand : null;
      // The settings section slot provides useSessions (standard prop); pick the
      // current/first attached session so standard commands can run.
      // SessionListState shape: { byId: { [id]: summary }, current: <id>, phase }.
      let sessionId = null;
      if (typeof props.useSessions === "function") {
        try {
          sessionId = props.useSessions(function (state) {
            if (state !== null && typeof state === "object") {
              if (typeof state.current === "string" && state.current !== "") return state.current;
              if (state.byId !== null && typeof state.byId === "object") {
                const keys = Object.keys(state.byId);
                if (keys.length > 0) return keys[0];
              }
            }
            return null;
          });
        } catch (err) {
          sessionId = null;
        }
      }

      const [status, setStatus] = React.useState(null);
      const [list, setList] = React.useState(null);
      const [url, setUrl] = React.useState("");
      const [phase, setPhase] = React.useState("idle");
      const [busy, setBusy] = React.useState(false);
      const [lines, setLines] = React.useState([]);
      const [result, setResult] = React.useState(null);
      const pollRef = React.useRef(null);

      const canRun = executeCommand !== null && typeof sessionId === "string" && sessionId !== "";

      const run = async function (line) {
        if (!canRun) throw new Error("设置页缺少会话上下文，无法调用宿主命令");
        const value = await executeCommand(sessionId, line);
        if (value === undefined) return { ok: false, error: "命令无返回" };
        let data = null;
        if (typeof value.text === "string" && value.text !== "") {
          try { data = JSON.parse(value.text); } catch (err) { data = { ok: value.kind === "success", raw: value.text }; }
        }
        if (value.kind === "error" && data === null) return { ok: false, error: value.text || "命令失败" };
        return data === null ? { ok: value.kind === "success" } : data;
      };

      React.useEffect(function () {
        let disposed = false;
        Promise.resolve()
          .then(function () { return run("/ghp-status"); })
          .then(function (s) { if (!disposed) setStatus(s); })
          .catch(function (err) { if (!disposed) setStatus({ ok: false, error: String(err) }); });
        Promise.resolve()
          .then(function () { return run("/ghp-list"); })
          .then(function (l) { if (!disposed) setList(l); })
          .catch(function (err) { if (!disposed) setList({ ok: false, error: String(err) }); });
        return function () { disposed = true; };
      }, [sessionId]);

      const stopPoll = function () {
        if (pollRef.current !== null) { clearTimeout(pollRef.current); pollRef.current = null; }
      };
      const poll = async function () {
        try {
          const st = await run("/ghp-status");
          const op = st && st.operation ? st.operation : {};
          if (Array.isArray(op.lines)) setLines(op.lines);
          if (!op.running) {
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

      const startAction = async function (command) {
        if (busy) return;
        setBusy(true);
        setResult(null);
        setLines([]);
        try {
          const started = await run(command);
          if (started && started.ok === true && started.started === true) {
            setPhase("running");
            return;
          }
          setPhase("error");
          setResult(started || { ok: false, error: "命令未启动" });
          setBusy(false);
        } catch (err) {
          setPhase("error");
          setResult({ ok: false, error: String(err) });
          setBusy(false);
        }
      };

      const onInstall = function () { void startAction("/ghp-install " + url); };
      const onRefresh = function () {
        setList(null);
        run("/ghp-list").then(setList).catch(function () {});
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

      const sessionNode = canRun
        ? null
        : React.createElement("p", { className: "ghp-banner" },
            "当前设置页没有可用的会话上下文，标准命令无法调用。请先打开一个会话，或在对话中直接使用 manage_plugin 工具。");

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
              if (p.hasBundle) line += "  [宿主端 bundle]";
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

      const listNode = list === null
        ? React.createElement("div", { className: "ghp-empty" }, "列表加载中…")
        : list.ok !== true
          ? React.createElement("div", { className: "ghp-empty" }, "列表不可用：" + String(list.error || "未知"))
          : list.rows.length === 0
            ? React.createElement("div", { className: "ghp-empty" }, "没有已安装的插件")
            : React.createElement("div", { className: "ghp-list" },
                list.rows.map(function (row) {
                  const badges = [];
                  if (row.hasBundle) badges.push(React.createElement("span", { key: "b", className: "ghp-badge" }, "bundle"));
                  if (row.hasClient) badges.push(React.createElement("span", { key: "c", className: "ghp-badge" }, "client"));
                  if (row.protected) badges.push(React.createElement("span", { key: "p", className: "ghp-badge" }, "保护"));
                  return React.createElement("div", { key: row.name, className: "ghp-item" },
                    React.createElement("div", { className: "ghp-item-main" },
                      React.createElement("div", { className: "ghp-item-name" }, row.name),
                      React.createElement("div", { className: "ghp-item-meta" },
                        (row.version ? row.version + " · " : "") + row.spec),
                      badges.length > 0
                        ? React.createElement("div", { className: "ghp-item-badges" }, badges)
                        : null),
                    row.protected
                      ? null
                      : React.createElement("div", { className: "ghp-item-actions" },
                          React.createElement("button", {
                            className: "ghp-btn ghp-ghost",
                            disabled: busy || !canRun,
                            onClick: function () { void startAction("/ghp-update " + row.name); },
                          }, "更新"),
                          React.createElement("button", {
                            className: "ghp-btn ghp-danger",
                            disabled: busy || !canRun,
                            onClick: function () { void startAction("/ghp-uninstall " + row.name); },
                          }, "卸载")));
                }));

      return React.createElement("div", { className: "ghp-card" },
        React.createElement("h3", { className: "ghp-title" }, "插件安装 / 卸载 / 更新"),
        React.createElement("p", { className: "ghp-desc" },
          "粘贴 GitHub 仓库网址、npm 包名或 Git 仓库地址即可安装（标准 dsh plugin add github:… 协议，与 dsh-market 相同）。支持 monorepo 子目录 /tree/<分支>/<子目录>。"),
        statusNode,
        sessionNode,
        React.createElement("div", { className: "ghp-row" },
          React.createElement("input", {
            className: "ghp-input",
            value: url,
            placeholder: "https://github.com/owner/repo 或 npm 包名",
            disabled: busy || !canRun,
            onChange: function (e) { setUrl(e.target.value); },
            onKeyDown: function (e) { if (e.key === "Enter" && !busy && canRun && url.trim() !== "") onInstall(); },
          }),
          React.createElement("button", {
            className: "ghp-btn",
            onClick: onInstall,
            disabled: busy || !canRun || url.trim() === "",
          }, busy ? (phase === "running" ? "进行中…" : "处理中…") : "安装"),
          phase === "running"
            ? React.createElement("button", {
                className: "ghp-btn ghp-ghost",
                onClick: function () { void run("/ghp-cancel").catch(function () {}); },
              }, "取消")
            : null),
        logNode,
        resultNode,
        React.createElement("div", { className: "ghp-row" },
          React.createElement("h3", { className: "ghp-title" }, "已安装插件"),
          React.createElement("button", { className: "ghp-btn ghp-ghost", onClick: onRefresh, disabled: !canRun }, "刷新")),
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
            setup: function (uiHost) {
              return {
                inject: function () {
                  return {
                    executeCommand: uiHost.executeCommand,
                    readAttachment: uiHost.readAttachment,
                  };
                },
              };
            },
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
          message: "dsh-github-installer: SettingsSection 插件安装（browser.ui.dsh/v1alpha1）",
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
