# dsh-github-installer

**基于 dsh-std 标准化协议的插件管理器** —— 粘贴 GitHub 仓库网址 / npm 包名 / 其他 Git 仓库地址，即可安装；支持卸载与更新。

**A dsh-std standard component for managing plugins** — install from a GitHub repo URL, npm package name, or any git repo; uninstall and update included.

## 特性 / Features

- 纯 **dsh-std Community v0.15** 标准组件：`dsh-plugin.json` + host/browser facets，由 `@dsh-std/adapter-dsh` 激活，显示在 **设置 → 插件 → 标准组件** 清单
- **安装**：GitHub 网址（含 monorepo `/tree/<分支>/<子目录>`）、`owner/repo`、npm 包名（`dshmarket`、`@scope/pkg`）、GitLab/Gitee 等其他 Git 仓库地址
- **卸载 / 更新**：列出全部第三方插件（`@deepseek-ai/*`、`@dsh-std/*`、`dshmarket`、自身受保护不可卸载），一键卸载/更新（Git 依赖重取 HEAD，npm 依赖更新到最新）
- 交互：**设置 → 插件安装**（标准 `SettingsSection`）+ 对话工具 **`manage_plugin`**（action: install / uninstall / update / status）
- 安装走标准 `dsh plugin add github:…` 协议（同 dsh-market），成功后自动对账 `dsh.profile.bundles`

## 安装 / Install

需要先安装适配器（标准协议运行时）：

```sh
dsh plugin --profile web add @dsh-std/adapter-dsh
dsh plugin --profile web add github:yhPrime/dsh-github-installer
```

重启 DSH 后，**设置 → 插件 → 标准组件** 出现本组件；设置侧栏出现 **插件安装** 页。

## 使用 / Usage

### 对话工具（模型工具）

`manage_plugin`：`action` = `install` | `uninstall` | `update` | `status`，`target` = 仓库网址/包名/插件包名。

```
install https://github.com/owner/repo
install github:owner/repo#path:/subdir
install dshmarket
install https://gitlab.com/group/repo
uninstall dsh-some-plugin
update dsh-some-plugin
status
```

### 标准命令（设置页 UI 内部调用）

`/ghp-install <target>` · `/ghp-uninstall <name>` · `/ghp-update <name>` · `/ghp-list` · `/ghp-status` · `/ghp-cancel`

## 工作原理 / How it works

- **Host facet**（`lib/host.js`）：发布 6 个标准命令 + `manage_plugin` 工具；`lib/installer.js` 用桌面打包的 pnpm 管线执行（`node.exe` + `.desktop-bin/pnpm-runner.mjs` + 打包 pnpm，与 dsh-market 相同），完成后对账 `dsh.profile.bundles`
- **Browser facet**（`lib/ui.js`）：通过标准 `ContributionHost` 注册 `SettingsSection`，UI 经 `executeCommand` 驱动宿主
- 状态/进度通过 `ghp-status` 轮询；单任务互斥，可取消
- 来源解析：`https://github.com/owner/repo` → `github:owner/repo`；npm 名直通；其他 Git 托管 → `git+https://…`

## 受保护包 / Protected packages

`@deepseek-ai/*`、`@dsh-std/*`、`dshmarket` 及本插件自身不可通过本工具卸载。

## License

MIT
