# dsh-todo-sticky

**每个对话一只任务框 + 强制模型先列清单。**

> ### ⚠️ 全程由 AI 生成
>
> 这个插件的**代码、样式、测试与文档全部由 AI 生成**（DeepSeek Harness 里的 `deepseek-flash`），人类只负责提需求与验收，没有手写过一行代码。
>
> 所以：实现思路不一定最优，可能带着 AI 式的过度设计与想当然。请自行审阅后再用于生产环境。
>
> *This plugin — code, styles, tests and docs — was written entirely by an AI.*


- 🗂 **每个对话各有一只**任务框，摆在输入框正上方（官方面板那个位置）。没写过清单时也照样摆着，显示「等待列出任务清单…」
- 🪟 **滑动窗口**：默认只显示三行——上一个已完成的 / 当前进行中的 / 下一个待处理的；每完成一项向前滚一格
- 🎨 **一眼看懂状态**：待办灰空心圈 / 进行中**蓝色呼吸灯** / 已完成绿色 + 删除线
- 🔀 三种模式：滑动窗口 ⇄ 展开全部 ⇄ 最小化
- 📏 **强制清单（两层）**：系统提示词里注入硬性纪律；真不听话时，**同一轮连续两个步骤调用工具却还没清单，就直接往模型的消息里塞一条提醒**当场要求补上
- 🔌 在 **设置 → 插件** 里一键开关（就是普通插件，可随时禁用/卸载）

## 它解决什么

DSH 官方自带一个任务面板（`conversation.input.dock` 里那个 `[data-testid="todo-panel"]`），但官方源码里写死了两条限制：

```js
// @deepseek-ai/dsh-tool-todo —— 投影定义
apply: (state, event) => {
  if (event.type === "todo/write") return event.data.todos;
  if (event.type === "turn/start") return null;   // ← 每轮开始清空
  return state;
}

// @deepseek-ai/dsh-client-ui-conversation —— TodoPanel
const [collapsed, setCollapsed] = useState(true);  // ← 默认折叠成一行
if (todos.length === 0) return null;               // ← 空就整个不渲染
```

| 现象 | 原因 |
|---|---|
| 我一发下一条消息，面板就没了 | `turn/start` 把 `todos` 置回 `null` |
| 新对话里根本没有任务框 | 空清单时官方组件直接 `return null` |
| 看到也只有一行、要点一下才展开 | `useState(true)`，且折叠状态不持久化 |
| 模型经常不列清单就开始干活 | 光靠工具描述约束不住 |

## 它怎么做的

| 半边 | 做法 |
|---|---|
| 宿主半 `lib/index.js` | ① 在投影表里再注册一个独立键 **`todosSticky`**，折叠同样的 `todo/write` 事件，**但不在 `turn/start` 清空**；② 用 `ctx.systemPrompt.section()` 注入「任务清单纪律」提示词段（`order: 700`，落在官方 `PLAN_POLICY=500` / `TEAM_POLICY=600` 之后的策略带里，排在所有工具说明 `1000+` 之前） |
| 客户端半 `lib/client.js` | 在**同一个 slot**（`conversation.input.dock`）渲染自己的框，读 `useProjection("todosSticky")`；**空清单也渲染**（官方是 `null`）；有内容时才用 CSS 隐藏官方那枚 |

官方 `todos` 键、官方组件、官方行为**一点没动**。本插件若失效（组件不渲染），`<html>` 上的标记会摘掉，官方面板自动回来。

数据仍是**会话级**的：每个对话各有一份，**互不继承**。

外观不是自创的：类名换了前缀，但每条 CSS 声明都照抄官方 `TodoPanel.module.css`，图标与状态点用官方 `@deepseek-ai/dsh-client-ui-primitives` 的 `IconChecklistOutlineRegular` / `IconChevron{Up,Down}OutlineRegular` / `StateDot`，颜色走 `--dsw-*` 设计 token。

## 三种显示模式

头部右侧那个小按钮在**滑动窗口**与**展开全部**之间切换；点头部本身**最小化 / 还原**。选择记在 localStorage（`dsh-todo-sticky:mode`）。

| 模式 | 内容 |
|---|---|
| **滑动窗口**（默认） | 头部摘要 + 三行：**上一个已完成的** / **当前进行中的** / **下一个待处理的** |
| **展开全部** | 头部摘要 + 完整清单 |
| **最小化** | 只有头部摘要一行 |
| **空态** | 摘要显示「尚未列出清单」，正文一行「等待列出任务清单…」 |

滑动窗口以「当前项」为锚——第一个 `in_progress`；没有就取第一个 `pending`（清单刚写好、还没开工）；全做完了就只留最后一项。然后：

- 往上找**最近的 `completed`**：没有就不显示这行（所以第一项进行中时上面是空的）
- 往下找**最近的 `pending`**：没有就不显示这行（收尾阶段下面会空出来）

于是每完成一项、把 `in_progress` 往下推一格，窗口就整体**向前滚一格**。

```
任务  3 已完成 · 1 进行中 · 2 待处理        全部
  ✓ 读取并比对候选插件
  ● 改客户端半为滑动窗口        ← 蓝色呼吸灯
  ○ 浏览器里验证渲染
```

### 状态配色

| 状态 | 状态点 | 文字 | token |
|---|---|---|---|
| `pending` 待办 | 灰色**空心圈** | 三级灰 | `--dsw-alias-label-tertiary` |
| `in_progress` 进行中 | **蓝色实心点 + 呼吸灯**（明暗 + 辉光脉动，1.6s 循环） | 一级文字色 | `--dsw-alias-state-business-primary`（该 token 缺席时退回 `--dsw-alias-brand-primary`） |
| `completed` 已完成 | 绿色实心点 | 绿色 + 同色删除线 | `--dsw-alias-state-success-primary` |

状态点是**自绘**的，不是官方 `StateDot`：官方那枚只有 done/idle 两种圆点加一个转圈 spinner，颜色还封在它自己的 CSS module 里，做不出呼吸灯。整段动画带 `prefers-reduced-motion` 守卫，系统开了「减少动态效果」就退化成静态蓝点。

## 强制清单

分两层：**软强制**讲清楚规矩，**硬强制**在违规发生的那一刻把话塞到模型眼前。

### 第一层：软强制（系统提示词）

宿主半注入的提示词段（要点）：

```
## 任务清单纪律（强制）

只要一件事需要两个或更多步骤（要连续调用工具，或要跨多轮才能做完），就必须先调用
`todo_write` 把完整步骤列成清单，然后才开始动手。不允许先干活后补清单。

- 清单一次覆盖整件事的全过程，一步一条，用可验收的祈使句
- 同一时刻只允许一条 `in_progress`
- 切换步骤时，在同一次调用里把上一步改成 `completed`、把下一步改成 `in_progress`
- 每完成一步立刻更新；最后一步也要标 `completed`
- 只有纯问答（不调用任何工具、一次回复就结束）才可以不建清单
```

### 第二层：硬强制（跳步拦截门）

在 `tools/post-execute` 上挂一道门：**同一轮里「至少调用过一次工具」的步骤数 ≥ 2，而这一轮还没有任何清单**时，把一条提醒作为 `additionalContexts` 附在这次工具结果上——模型下一步必然看到它。

几个刻意的设计选择：

| 选择 | 理由 |
|---|---|
| 阈值 = **2 个「动用工具的步骤」**，不是 2 次工具调用 | 对齐纪律原文「两个或更多步骤（要连续调用工具）」。同一步里并行发 3 个调用只算 1 步 |
| 每轮**最多提醒一次** | 补了清单就自动让开；硬干到底也不刷屏，下一轮再说 |
| 提醒走 `additionalContexts` + **自定义 `source.kind`** | 平台官方做法（同 `@deepseek-ai/dsh-repeat-tool-reminder`）。官方源码注明「an unlabeled context would render as a user prompt in derived history」——`kind` 绝不能省，否则提醒会在对话里**伪装成你说的话** |
| 任何判断失败都放行原结果 | 提醒是增强，不是主流程，不能因为它坏了一次工具调用 |
| 状态按会话 + 回合复位 | `turn/start` 清零；`todo/write` 一到就视为合规 |

提醒正文：

```
⚠️ 本轮已经连续 2 个步骤在调用工具，但还没有建立任务清单——这违反了「任务清单纪律（强制）」。

现在请立刻调用 `todo_write`：把整件事的完整步骤列出来（已经做完的步骤也要列出并标
`completed`，当前这一步标 `in_progress`），然后再继续动手。之后每完成一步，就在同一次
调用里把状态往前推一格。
```

## 安装 / 开关 / 卸载

**开关**：设置 → 插件 → 找到 `dsh-todo-sticky` → 关掉即可（客户端面板与强制清单一起停）。也能在插件详情里单独移除。

```sh
# 先把仓库克隆到本机任意位置，再源码直挂（路径按你的实际位置替换）
git clone https://github.com/pjjlff1314-dev/dsh-todo-sticky.git
plugin_manager install_bundle  target=link:/absolute/path/to/dsh-todo-sticky
```

或写进 profile 的 `cordis.patch.yml`：

```yaml
- insert:
    - id: todo-sticky
      name: dsh-todo-sticky
```

⚠️ **改 `lib/index.js`（宿主半）必须完全重启应用**——实测：Node 的 ESM 模块缓存不会因文件改动或「禁用再启用」而重新执行，`dsh-hmr` 也不监听 `link:` 目录。

**改 `lib/client.js`（客户端半）不用重启**：`dsh-client-hmr` 每 500ms 轮询 bundle 的 mtime/ctime/size，变了就 `clientModules.rebuilt(id)` 发布新版本，并通过 SSE 推给浏览器；最坏情况刷新一次页面即可。

卸载：`plugin_manager remove_bundle target=dsh-todo-sticky`。

## 配置

无配置文件、无网络请求、**零运行时依赖**。唯一本地写入是 localStorage 里的折叠选择。

## 兼容性

- 宿主半依赖 `ctx.sessionProjections`（投影注册契约）与 `ctx.systemPrompt.section()`（提示词段契约）。
- `stateSchema` / `viewSchema` 手写为「带 `.parse()` 的对象」——投影表只调用 `.parse()`（snapshot / checkpoint / restore 三处，无 `safeParse`、无 `instanceof`），因此无需引入 zod。
- 客户端半只依赖 `react` 与 `@deepseek-ai/dsh-client-ui-primitives` 两个平台模块，走 `window.__ModuleLoader__.load({id, factory})` 的懒 CJS 契约。
- 在 `0.2.0-rc.2` 上开发与验证。

## 本地验证

开发时用一套 **74 项断言**的自检脚本跑真实源码（脚本属于本地开发脚手架，未随仓库发布）：

- **宿主半**：直接 `import` 后用桩 ctx 抓住注册的投影 / 提示词段 / 事件监听器，断言投影语义（`turn/start` 不清空）与提示词段的 order / 内容 / 插值开关
- **硬强制门**：**真的跑一遍注入往返**——模拟 `session/event` 与 `tools/post-execute`，覆盖：第 1 个工具步骤不打扰 / 第 2 个命中并注入 / 不重复刷屏 / 补了清单自动让开 / 新一轮重新抓 / 同一步并行多次只算 1 步 / `block` 分支保留 feedback / 与下游 contexts 合并顺序 / 无 agent 的调用不参与
- **客户端半**：真 React 18 把真实 `lib/client.js` 渲染成静态 HTML，逐模式断言行数、状态顺序、摘要文案、模式按钮与空态
- **状态配色**：把注入的 CSS 文本抓出来，断言三态各自绑到正确的 `--dsw-*` token、呼吸关键帧与 `prefers-reduced-motion` 降级都在、红色异常态与 `data-tone` 已彻底移除、官方 `StateDot` 调用次数为 0
