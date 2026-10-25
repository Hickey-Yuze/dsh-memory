# Windows 接入 GitHub 记忆同步

目标：Mac 与 Windows 各跑一份 dsh-memory，平时只用一台；用完点「上传到远端」，另一台点「从远端同步」，两份记忆按 id 并集合并成一份。

> 一句话原理：`records.json` 这类文件是**整表原子写**（写 tmp → rename 覆盖）。Syncthing / iCloud / Dropbox 同步的是文件块，两台各写一次后，后写的整表会把先写的**整份盖掉**——丢的不是几条，是两千多条。所以这里不做文件夹同步，改成「显式上传 / 显式拉取 + 语义合并」。

---

## 0 先决条件

| 项 | 要求 |
|---|---|
| 两台机器 | 都装了 Yuze Harness（DSH）桌面版，且**版本尽量一致**（插件调用的宿主接口随版本变化） |
| Mac 侧 | dsh-memory 已装好、记忆正常（这一步是 Mac 现状，无需改动） |
| 网络 | 两台都能访问 `api.github.com`（公司网络若拦截，见文末「自建/代理」） |

先在 **Mac** 上确认插件是活的：设置页能看到「记忆」分区，或对话里能触发召回。看不到就别往下走。

---

## 1 建一个私有仓库放快照

GitHub → **New repository**

- 名字：`dsh-memory-sync`（随意，后面填进配置的是 `owner/repo`）
- 可见性：**Private**
- 勾 **Add a README file**（推荐；不勾也行，插件在空仓库上会自动创建 `main` 分支）

建完记下 `owner/repo`，例如 `Hickey-Yuze/dsh-memory-sync`。

> 仓库里只有三样东西：`memory-sync/snapshot.json.gz`、`manifest.json`、`devices/<设备id>.json`。没有你的对话原文（L0 默认不同步）。

---

## 2 建细粒度 Token

GitHub → 头像 → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**

| 字段 | 值 |
|---|---|
| Token name | `dsh-memory-sync` |
| Expiration | 90 天（到期会同步失败，记得换） |
| Repository access | **Only select repositories** → 只选 `dsh-memory-sync` |
| Permissions → Repository permissions → **Contents** | **Read and write** |

其余权限一个都不要给。生成后**当场复制**（只显示一次）。

> 这个 token 会以明文存在 `%USERPROFILE%\.dsh\dsh-memory\config.json` 的 `sync.token` 字段里，且**不会**被同步到另一台机器。所以两台要各填一次。泄露了就去 GitHub 撤销重发。

---

## 3 Mac 侧配置并上传（必须先做）

Mac → DSH 设置页 → **维护** → **跨设备同步（GitHub 快照）** → 点「配置同步」，填：

| 字段 | 填什么 |
|---|---|
| GitHub 仓库（owner/repo） | `Hickey-Yuze/dsh-memory-sync` |
| GitHub Token | 第 2 步的 PAT |
| 分支 | `main` |
| 本机名称 | `Mac mini`（留空则用主机名） |
| 连 L0 原始对话一起同步 | **不勾**（勾了体积 +2MB 且会带原始对话） |

点「保存配置」→ 点「**上传到远端**」。

成功提示形如：`已上传：633KB（远端原本是空的）`。状态行变成 `远端：Mac mini 于几秒前上传 · 记忆 2769 条 / 633KB`。

**验证**：去 GitHub 仓库看，应出现 `memory-sync/snapshot.json.gz`、`manifest.json`、`devices/`。

> 这一步不能跳过。远端空的，Windows 点「同步」拉不到任何东西。

---

## 4 Windows 装插件

Windows 上的 DSH 家目录是 `%USERPROFILE%\.dsh`（若设了环境变量 `DSH_HOME`，以它为准）。

先确认 profile 目录：打开 `%USERPROFILE%\.dsh\profiles\`，里面通常只有一个 `desktop`（有 `package.json` 的就是它）。下文用 `<PROFILE>` 代指该目录。

### 4.1 拿到插件代码（任一方式）

**方式 A：git clone（推荐，后续好更新）**

```cmd
git clone https://github.com/Hickey-Yuze/dsh-memory.git "%USERPROFILE%\.dsh\plugins\dsh-memory"
```

**方式 B：从 Mac 拷**

Mac 上先压缩（**排除** `backfill/`、`.git/`、`node_modules/`）：

```bash
cd /Users/yuze/.dsh
tar --exclude='backfill' --exclude='.git' --exclude='node_modules' \
    -czf /tmp/dsh-memory.tgz -C plugins dsh-memory
```

把 `dsh-memory.tgz` 传到 Windows，解压到 `%USERPROFILE%\.dsh\plugins\dsh-memory`。

> ⚠️ **千万别拷 `%USERPROFILE%\.dsh\dsh-memory\` 这个数据目录**（那是记忆本体，里面是 Mac 的会话和绝对路径）。Windows 这边的数据目录要自己长出来，内容靠同步合并。

### 4.2 让它出现在 node_modules 里

插件是纯 ESM、**零运行时依赖**，所以不需要 `npm install` 就能跑。三条路，按环境选：

**路线 1：直接拷进 node_modules（最稳，什么工具都不用装）**

```cmd
xcopy /E /I /Y "%USERPROFILE%\.dsh\plugins\dsh-memory" "%USERPROFILE%\.dsh\profiles\<PROFILE>\node_modules\dsh-memory"
```

更新插件时重跑这条即可。

**路线 2：目录联接（junction，不占第二份空间）**

cmd **管理员**窗口：

```cmd
mklink /J "%USERPROFILE%\.dsh\profiles\<PROFILE>\node_modules\dsh-memory" "%USERPROFILE%\.dsh\plugins\dsh-memory"
```

PowerShell 等价写法（不需要管理员）：

```powershell
New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\profiles\<PROFILE>\node_modules\dsh-memory" -Target "$env:USERPROFILE\.dsh\plugins\dsh-memory"
```

**路线 3：有 Node/npm 时走标准安装**

在 `%USERPROFILE%\.dsh\profiles\<PROFILE>\package.json` 的 `dependencies` 里加一行：

```json
"dsh-memory": "link:../../plugins/dsh-memory"
```

然后在 profile 目录执行 `npm install`。

> 注意 `link:` 的相对路径是**从 profile 目录算**：`%USERPROFILE%\.dsh\profiles\desktop` → 上两级 `..\..` 到 `.dsh`，再进 `plugins\dsh-memory`。

### 4.3 注册到 bundles

编辑 `%USERPROFILE%\.dsh\profiles\<PROFILE>\package.json`，找到 `dsh.profile.bundles` 数组，把 `"dsh-memory"` 加进去（放在 `"dsh-chat-import"` 之类旁边即可，顺序无关）：

```json
"dsh": {
  "profile": {
    "bundles": [
      "@deepseek-ai/dsh-base",
      "@deepseek-ai/dsh-web-app",
      "dsh-memory"
    ],
    "patchReload": "live"
  }
}
```

保存。**JSON 严格**——多一个逗号整个 profile 加载失败。

### 4.4 重启 DSH

完全退出（托盘也退）再启动。

**验证**：设置页出现「记忆」分区，且「跨设备同步」面板能打开。看不到就去看宿主日志：

```
%USERPROFILE%\AppData\Roaming\Yuze Harness\logs\*.error.log
```

搜 `plugin tree failed to load` 或 `dsh-memory`。

---

## 5 Windows 侧配置并首次同步

设置页 → **维护** → **跨设备同步** → 「配置同步」：

| 字段 | 填什么 |
|---|---|
| GitHub 仓库 | 与 Mac 相同 `owner/repo` |
| GitHub Token | **同一个 PAT**（或另发一个，权限相同） |
| 分支 | `main` |
| 本机名称 | `Windows` |
| 连 L0 | 不勾 |

保存后，状态行应显示 Mac 刚上传的那条快照：`远端：Mac mini 于 X 前上传 · 记忆 2769 条 / 633KB`。

**看到这条才说明仓库和 token 都通了。** 看不到 → 见排错第 1 条。

然后点「**从远端同步**」。成功提示：

```
已同步：记忆 +2769/~0 · 场景 +205/~0 · 偏差 +3（备份已存 dataDir）
```

首次是 `+2769`（本地空，全量拉下来）。之后每次只会是增量。

---

## 6 日常怎么用

单向「用完就走」的流程，照着做就不会错：

1. 在 **Mac** 上用到告一段落 → 点「上传到远端」
2. 换到 **Windows** → 打开 DSH → 点「从远端同步」→ 接着干
3. Windows 用完 → 点「上传到远端」
4. 回 Mac → 点「从远端同步」

要点：

- **「上传」会自动先合并远端再传**，所以即使在 Mac 上传前 Windows 忘了同步，Mac 传上去的内容里也会带上远端已有的部分（不会把 Windows 那份抹掉）。
- **「同步」会先备份** `records.json.bak-sync-<时间戳>` 再覆盖，出问题能从 `%USERPROFILE%\.dsh\dsh-memory\` 里捞回来。
- 两台**不要同时开着改**。合并能兜住，但你会分不清哪条记忆是哪台改的。

---

## 7 排错

**① 状态行显示「远端读取失败」**

- token 错 / 过期 / 权限不够 → 重新发一个，确认 Contents 是 **Read and write**
- 仓库名写成 `https://github.com/owner/repo` → 只填 `owner/repo`
- 分支写错（默认 `main`，老仓库可能是 `master`）

**② 点上传报 `Update is not a fast forward`**

插件版本太旧（< 0.1.x 修复版）：远端已有 README 等提交时，旧版上传的 commit 没有父级，被 GitHub 拒绝。升级到含 `fix(sync): 上传接上远端既有提交` 的版本即可。临时绕法：删掉远端 `main` 分支再上传。

**③ 设置页压根看不到「记忆」分区**

插件没加载。按顺序查：`node_modules\dsh-memory` 是否存在（路线 1/2）→ `bundles` 里有没有 `"dsh-memory"` → `package.json` 是否 JSON 合法 → 宿主 error 日志。

**④ 同步后记忆条数没变**

- 检查是不是两台数据完全一样（那本来就 +0）
- 看提示里的 `~N`（更新数）：合并按 `updatedAt` 晚者胜，内容相同的不会变
- 确认调的是「从远端同步」而不是只看状态

**⑤ 同步完某条记忆不见了**

删除是靠墓碑（`sync-tombstones.json`）传播的——一台删了，另一台同步后也会删。这是设计行为。要找回：从 `.bak-sync-*` 备份里恢复，或翻 `conversations/` 里的 L0 原文重新蒸馏。

**⑥ Windows 上路径带中文（如 `C:\Users\华硕\...`）**

代码本身跨平台（路径分隔符、`USERPROFILE` 都处理了）。唯一注意：cmd 命令里的路径**一律加双引号**。

**⑦ 想换仓 / 想停用**

设置页「修改配置」改 repo 即可（新仓库要从头传一次）。不想用了就把「跨设备同步」的开关关掉，或直接不点按钮——不点就不会有网络请求。

---

## 8 不同步的东西（各机本地）

这些文件在同步面板底部会列出来，永远不参与合并：

```
config.json  session-modes.json  recall-dedupe.json  vectors.json
kb-index.json  state.json  activity.jsonl  usage.jsonl  merge-log.jsonl
conversations/（L0，除非显式勾选）
```

原因：会话 id、绝对路径、召回计数在两台机器上没有可比性，混进来只会污染。**token 也在 `config.json` 里，所以不会跨机传播**——这是有意为之。

---

## 9 体积参考

真实库（2769 条 L1 + 205 个 L2 场景 + 3 条偏差）：压缩后 **约 630KB**（records 484KB + scenes 149KB + bias 2KB）。数字随使用增长，量级不变。GitHub 单文件上限 100MB，几万条记忆也碰不到。L0 全量约 +2MB（默认不开）。

---

## 附：自建 / 代理 API

配置项 `sync.apiBase` 默认 `https://api.github.com`。走代理或 GitHub Enterprise 时改这里（设置页暂未暴露该字段，可改 `%USERPROFILE%\.dsh\dsh-memory\config.json` 的 `sync.apiBase` 后重启）。
