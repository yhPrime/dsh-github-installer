# dsh-github-installer

**GitHub 仓库一键安装插件** —— 粘贴任意 GitHub 插件仓库网址，即可安装到当前 web 配置。使用标准 `dsh plugin add github:owner/repo` 协议（与 dsh-market 相同），支持 monorepo 子目录安装。

**Install any DeepSeek Harness plugin from a GitHub repo URL** — paste a repo URL, install. Uses the standard `github:owner/repo` protocol, the same one dsh-market uses; monorepo subpackages supported.

## 安装 / Install

```sh
dsh plugin --profile web add github:yhPrime/dsh-github-installer
```

重启 DSH 后打开 **设置 → 插件 → 插件安装**。

Restart DSH, then open **Settings → Plugins → 插件安装** (Plugin Installer).

## 使用 / Usage

| 输入 | 结果 |
| --- | --- |
| `https://github.com/owner/repo` | `github:owner/repo` |
| `https://github.com/owner/repo/tree/<分支>/<子目录>` | `github:owner/repo#path:/<子目录>` |
| `owner/repo` / `github:owner/repo` | 直接可用 |

粘贴网址 → 安装 → 实时 pnpm 日志 → 结果卡片（标注「宿主端 bundle / 客户端 / dsh-std 协议」与生效提示）。

- 客户端部分：刷新页面生效
- 宿主端补丁（`dsh.bundle`）：需要重启 DSH 生效
- 基于 dsh-std 协议的插件：需已安装 `@dsh-std/adapter-dsh`（状态栏会检测）

## 工作原理 / How it works

- 宿主端挂载 `/ghp-installer/*` HTTP 路由，走桌面打包的 pnpm 管线（`node.exe` + `.desktop-bin/pnpm-runner.mjs` + 打包 pnpm），与 dsh-market 在 Desktop 上的安装路径一致
- 安装成功后自动把新装的 bundle 插件追加进 `dsh.profile.bundles`（等价于 `dsh plugin` CLI 的对账）
- 变更型路由仅接受同源 POST

## License

MIT
