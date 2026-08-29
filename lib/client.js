window.__ModuleLoader__.load({
  id: "ghp-installer",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");

    const inject = ["slots"];

    const API = {
      status: "/ghp-installer/status",
      install: "/ghp-installer/install",
      poll: "/ghp-installer/status-poll",
      cancel: "/ghp-installer/cancel",
    };

    async function getJson(path) {
      const response = await fetch(path, { credentials: "same-origin", cache: "no-store" });
      const text = await response.text();
      let data = null;
      try { data = text === "" ? null : JSON.parse(text); } catch { data = null; }
      if (!response.ok && data === null) throw new Error("HTTP " + response.status);
      return data;
    }

    async function postJson(path, payload) {
      const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
      const text = await response.text();
      let data = null;
      try { data = text === "" ? null : JSON.parse(text); } catch { data = null; }
      if (!response.ok && data === null) throw new Error("HTTP " + response.status);
      return data;
    }

    const CSS = `
.ghp-card{display:flex;flex-direction:column;gap:14px;max-width:720px;padding:20px 2px}
.ghp-title{margin:0;font-size:20px;font-weight:600;line-height:30px}
.ghp-desc{margin:0;font-size:13px;line-height:21px;color:var(--dsw-alias-label-secondary,#8b93a1)}
.ghp-row{display:flex;gap:8px}
.ghp-input{flex:1;min-width:0;padding:9px 12px;border:1px solid var(--dsw-alias-border-l2,#d8dce3);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#1f2328);font-size:13px;outline:none}
.ghp-input:focus{border-color:var(--dsw-alias-brand-primary,#4f6ef7)}
.ghp-btn{padding:9px 18px;border:none;border-radius:8px;background:var(--dsw-alias-brand-primary,#4f6ef7);color:var(--dsw-alias-label-primary-foreground,#fff);font-size:13px;font-weight:600;cursor:pointer}
.ghp-btn:disabled{opacity:.55;cursor:not-allowed}
.ghp-btn.ghp-ghost{background:transparent;border:1px solid var(--dsw-alias-border-l2,#d8dce3);color:var(--dsw-alias-label-secondary,#6b7280);font-weight:400}
.ghp-status{display:flex;flex-wrap:wrap;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280)}
.ghp-pill{padding:3px 10px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,#f2f3f5);border:1px solid var(--dsw-alias-border-l2,#e5e7eb)}
.ghp-pill.ghp-on{background:rgba(79,111,247,.1);border-color:rgba(79,111,247,.35);color:var(--dsw-alias-brand-primary,#4f6ef7)}
.ghp-log{max-height:200px;overflow:auto;margin:0;padding:10px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,#f2f3f5);border:1px solid var(--dsw-alias-border-l2,#e5e7eb);font:11px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;word-break:break-all;color:var(--dsw-alias-label-secondary,#6b7280)}
.ghp-result{margin:0;padding:12px 14px;border-radius:8px;font-size:13px;line-height:22px;white-space:pre-wrap;word-break:break-word}
.ghp-ok{background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.3)}
.ghp-err{background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.3);color:var(--dsw-alias-label-primary,#1f2328)}
`;
    const CSS_TAG = "ghp-installer/installer.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_TAG) + "]") === null) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "ghp-installer";
      tag.dataset.pluginCss = CSS_TAG;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    function InstallerSection() {
      const [status, setStatus] = React.useState(null);
      const [url, setUrl] = React.useState("");
      const [phase, setPhase] = React.useState("idle");
      const [busy, setBusy] = React.useState(false);
      const [lines, setLines] = React.useState([]);
      const [result, setResult] = React.useState(null);
      const pollRef = React.useRef(null);

      React.useEffect(() => {
        let disposed = false;
        getJson(API.status)
          .then((s) => { if (!disposed) setStatus(s); })
          .catch((err) => { if (!disposed) setStatus({ error: String(err) }); });
        return () => { disposed = true; };
      }, []);

      const stopPoll = () => {
        if (pollRef.current !== null) {
          clearTimeout(pollRef.current);
          pollRef.current = null;
        }
      };
      const poll = async () => {
        try {
          const st = await getJson(API.poll);
          if (st !== null && st.lines !== undefined) setLines(st.lines);
          if (st !== null && !st.running) {
            setPhase(st !== null && st.result !== null && st.result.ok === true ? "done" : "error");
            setResult(st !== null ? st.result : null);
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

      React.useEffect(() => {
        if (phase !== "running") return;
        pollRef.current = setTimeout(poll, 900);
        return stopPoll;
      }, [phase]);

      const onInstall = async () => {
        if (busy) return;
        setBusy(true);
        setResult(null);
        setLines([]);
        try {
          const res = await postJson(API.install, { url });
          if (res === null || res.error !== undefined) {
            setPhase("error");
            setResult({ ok: false, error: res === null ? "无响应" : res.error });
            setBusy(false);
            return;
          }
          setPhase("running");
        } catch (err) {
          setPhase("error");
          setResult({ ok: false, error: String(err) });
          setBusy(false);
        }
      };

      const onCancel = () => { void postJson(API.cancel, {}).catch(() => undefined); };

      const statusNode = status === null
        ? React.createElement("div", { className: "ghp-status" }, "状态加载中…")
        : status.error !== undefined
          ? React.createElement("div", { className: "ghp-status" }, "状态不可用：" + String(status.error))
          : React.createElement("div", { className: "ghp-status" },
              React.createElement("span", { className: "ghp-pill" }, "配置: " + status.profile.name),
              React.createElement("span", { className: status.adapterInstalled ? "ghp-pill ghp-on" : "ghp-pill" },
                status.adapterInstalled
                  ? "dsh-std 协议适配器已就绪 (" + status.adapterSpec + ")"
                  : "dsh-std 协议适配器未安装（std 插件需要 @dsh-std/adapter-dsh）"));

      const logNode = phase === "running"
        ? React.createElement("pre", { className: "ghp-log" }, lines.join(""))
        : null;

      let resultNode = null;
      if (result !== null) {
        if (result.ok === true) {
          const parts = [];
          for (const p of result.added) {
            let line = "✓ " + p.name + (p.version !== null ? "@" + p.version : "");
            if (p.hasBundle) line += "  [宿主端 bundle]";
            if (p.hasClient) line += "  [客户端]";
            if (p.stdDeps.length > 0) line += "  [dsh-std 协议]";
            parts.push(line);
          }
          if (result.stdPlugin && !result.adapterInstalled) parts.push("⚠ 该插件基于 dsh-std 协议，但 @dsh-std/adapter-dsh 未安装——请先安装适配器");
          parts.push("→ " + result.hint);
          resultNode = React.createElement("div", { className: "ghp-result ghp-ok" }, parts.join("\n"));
        } else {
          const text = result.error !== undefined ? result.error : "安装失败 (exit " + String(result.exitCode) + ")";
          const tail = result.stderrTail !== undefined && result.stderrTail !== "" ? "\n\n" + result.stderrTail.slice(-1500) : "";
          resultNode = React.createElement("div", { className: "ghp-result ghp-err" }, text + tail);
        }
      }

      return React.createElement("div", { className: "ghp-card" },
        React.createElement("h3", { className: "ghp-title" }, "GitHub 仓库一键安装"),
        React.createElement("p", { className: "ghp-desc" },
          "粘贴任意 GitHub 插件仓库网址，即可安装到当前 web 配置。使用标准 dsh plugin add github:… 协议（与 dsh-market 相同），支持 monorepo 子目录（/tree/<分支>/<子目录>）。"),
        statusNode,
        React.createElement("div", { className: "ghp-row" },
          React.createElement("input", {
            className: "ghp-input",
            value: url,
            placeholder: "https://github.com/owner/repo",
            disabled: busy,
            onChange: (e) => setUrl(e.target.value),
            onKeyDown: (e) => { if (e.key === "Enter" && !busy) onInstall(); },
          }),
          React.createElement("button", { className: "ghp-btn", onClick: onInstall, disabled: busy || status === null },
            busy ? (phase === "running" ? "安装中…" : "处理中…") : "安装"),
          phase === "running"
            ? React.createElement("button", { className: "ghp-btn ghp-ghost", onClick: onCancel }, "取消")
            : null),
        logNode,
        resultNode);
    }

    function apply(ctx) {
      const slots = ctx.get("slots");
      if (slots === undefined) return;
      slots.inject("settings.plugins.tab", () => slots.register(
        { name: "settings.plugins.tab", id: "ghp-installer", order: 40, label: () => "插件安装" },
        () => React.createElement(InstallerSection)
      ));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
