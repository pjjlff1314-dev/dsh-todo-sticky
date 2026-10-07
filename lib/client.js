/**
 * dsh-todo-sticky — 浏览器半（browser half）。
 *
 * 在 `conversation.input.dock`（输入框正上方那个位置、官方面板所在的那个 slot）
 * 渲染任务框，数据取自宿主半注册的 `todosSticky` 投影。
 *
 * ## 每个对话一只新框
 *
 * 这个框**在每个对话里都渲染**——即使这个对话还没写过任何清单，也先摆一只空的
 * 等着被填（官方那枚在 `todos.length === 0` 时直接 `return null`，什么都不显示）。
 * 数据仍然是**会话级**的：每个对话各有一份，互不继承。
 *
 * ## 三种显示模式
 *
 * | 模式 | 内容 |
 * |---|---|
 * | `compact`（默认，即「上述」） | 头部摘要 + **三行滑动窗口**：上一个已完成的 / 当前进行中的 / 下一个待处理的 |
 * | `expanded` | 头部摘要 + 完整清单 |
 * | `minimized` | 只有头部摘要一行 |
 *
 * 滑动窗口的语义：以「当前项」为锚（第一个 `in_progress`；没有就取第一个
 * `pending`；全做完了就取最后一项），向上找最近的 `completed`（没有就不显示这
 * 行）、向下找最近的 `pending`（没有就不显示这行）。所以每完成一个，窗口就整体
 * 向前滚一格。
 *
 * ## 状态配色
 *
 * | 状态 | 表现 |
 * |---|---|
 * | 待办 `pending` | 灰色空心圈 |
 * | 进行中 `in_progress` | **蓝色呼吸灯**（实心点做明暗 + 辉光脉动） |
 * | 已完成 `completed` | 绿色实心点 + 同色删除线 |
 *
 * 状态点是自绘的，不是官方 `StateDot`：官方那枚只有 done/idle 两种圆点加一个转圈
 * spinner，颜色还封在它自己的 CSS module 里，做不出呼吸灯。其余布局仍照抄官方
 * `TodoPanel.module.css`，颜色一律走 `--dsw-*` 设计 token。
 */
window.__ModuleLoader__.load({
	id: "dsh-todo-sticky",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		const h = React.createElement;

		const STYLE_ID = "dsh-todo-sticky-style";
		const MODE_KEY = "dsh-todo-sticky:mode";
		/** 挂在 <html> 上：只有本面板有内容要显示时才隐藏官方那枚，失败即降级回官方。 */
		const LIVE_ATTR = "data-todo-sticky";

		const MODE_COMPACT = "compact";
		const MODE_EXPANDED = "expanded";
		const MODE_MINIMIZED = "minimized";
		const MODES = [MODE_COMPACT, MODE_EXPANDED, MODE_MINIMIZED];

		const C = {
			root: "dsh-todo-sticky-root",
			body: "dsh-todo-sticky-body",
			header: "dsh-todo-sticky-header",
			headerMain: "dsh-todo-sticky-header-main",
			mode: "dsh-todo-sticky-mode",
			lead: "dsh-todo-sticky-lead",
			title: "dsh-todo-sticky-title",
			progress: "dsh-todo-sticky-progress",
			chevron: "dsh-todo-sticky-chevron",
			list: "dsh-todo-sticky-list",
			item: "dsh-todo-sticky-item",
			glyph: "dsh-todo-sticky-glyph",
			content: "dsh-todo-sticky-content",
			hint: "dsh-todo-sticky-hint"
		};

		// 主体照抄官方 TodoPanel.module.css（只换类名前缀）；模式控件、空态、进行中项
		// 强调与完成项划线是本插件加的。
		const CSS = [
			`.${C.root}{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));max-width:calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-elevation-panel);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);border:0;flex:none;margin:0 auto;overflow:hidden}`,
			`.${C.body}{flex-direction:column;gap:8px;padding:6px 12px;display:flex}`,
			`.${C.header}{align-items:center;gap:6px;width:100%;display:flex}`,
			`.${C.headerMain}{text-align:left;cursor:pointer;background:0 0;border:none;align-items:center;gap:10px;min-width:0;flex:auto;padding:0;display:flex}`,
			`.${C.mode}{cursor:pointer;background:0 0;border:none;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:20px;padding:0 2px;flex:none;border-radius:4px}`,
			`.${C.mode}:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}`,
			`.${C.lead}{color:var(--dsw-alias-label-tertiary);flex:none;place-items:center;display:grid}`,
			`.${C.title}{color:var(--dsw-alias-label-primary);flex:none;font-size:13px;font-weight:500;line-height:24px}`,
			`.${C.progress}{min-width:0;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;flex:auto;font-size:13px;font-weight:400;line-height:20px;overflow:hidden}`,
			`.${C.chevron}{color:var(--dsw-alias-label-tertiary);flex:none;place-items:center;display:grid}`,
			`.${C.list}{flex-direction:column;gap:8px;max-height:180px;margin:0;padding:0;list-style:none;display:flex;overflow-y:auto}`,
			`.${C.item}{min-width:0;color:var(--dsw-alias-label-secondary);align-items:center;gap:10px;font-size:13px;line-height:20px;display:flex}`,
			// 三态配色：待办=灰、进行中=蓝、已完成=绿。
			`.${C.item}[data-status='pending']{color:var(--dsw-alias-label-tertiary)}`,
			`.${C.item}[data-status='in_progress']{color:var(--dsw-alias-label-primary)}`,
			`.${C.item}[data-status='completed']{color:var(--dsw-alias-state-success-primary)}`,
			// 自绘状态点：圆点取 currentColor，所以行色即点色；待办画成空心圈（沿用官方
			// 语言），进行中换成蓝色实心点 + 呼吸动画。官方 StateDot 只有 done/idle 两态
			// 加一个转圈 spinner，颜色也封在它自己的 CSS module 里，做不出呼吸灯。
			`.${C.glyph}{flex:none;place-items:center;width:16px;height:16px;display:grid}`,
			`.${C.glyph}::before{content:'';box-sizing:border-box;width:10px;height:10px;border-radius:50%;background:currentColor}`,
			`.${C.item}[data-status='pending'] .${C.glyph}::before{background:0 0;border:1.5px solid currentColor}`,
			// business 是设计系统里「进行中」的语义色（蓝）；万一该 token 缺席就退回品牌蓝。
			`.${C.item}[data-status='in_progress'] .${C.glyph}{color:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary))}`,
			`.${C.item}[data-status='in_progress'] .${C.glyph}::before{animation:dsh-todo-sticky-breathe 1.6s ease-in-out infinite}`,
			`@keyframes dsh-todo-sticky-breathe{0%,100%{opacity:1;box-shadow:0 0 0 0 currentColor}50%{opacity:.35;box-shadow:0 0 6px 1px currentColor}}`,
			`@media (prefers-reduced-motion:reduce){.${C.item}[data-status='in_progress'] .${C.glyph}::before{animation:none}}`,
			`.${C.content}{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}`,
			// 「完成一个划掉一个」：官方只把文字调成三级色、不划线；删除线取当前色（绿）。
			`.${C.item}[data-status='completed'] .${C.content}{text-decoration:line-through;text-decoration-color:currentColor}`,
			// 空态：这个对话还没写过清单时占位，说明这只框在等什么。
			`.${C.hint}{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}`,
			// 本面板有内容时隐藏官方那枚，避免出现两份。
			`[${LIVE_ATTR}='on'] [data-testid='todo-panel']{display:none !important}`
		].join("");

		/** 模块副作用（含 CSS 注入）只在工厂实体化时发生——与官方客户端包的纪律一致。 */
		function ensureStyle() {
			if (typeof document === "undefined") return;
			if (document.getElementById(STYLE_ID) !== null) return;
			const style = document.createElement("style");
			style.id = STYLE_ID;
			style.textContent = CSS;
			document.head.appendChild(style);
		}

		/** 读上次选的模式；默认「上述」的紧凑窗口。 */
		function readMode() {
			try {
				const stored = window.localStorage.getItem(MODE_KEY);
				return MODES.includes(stored) ? stored : MODE_COMPACT;
			} catch {
				return MODE_COMPACT;
			}
		}

		function writeMode(mode) {
			try {
				window.localStorage.setItem(MODE_KEY, mode);
			} catch {
				/* 存不下只影响记忆，不影响功能 */
			}
		}

		/** 官方文案，逐字取自 @deepseek-ai/dsh-client-ui-conversation 的中文字典。 */
		function statusLabel(status) {
			if (status === "completed") return "已完成";
			if (status === "in_progress") return "进行中";
			return "待处理";
		}

		/** 头部摘要：与官方 progressLabel 逐字一致（0 计数的段落省略）。 */
		function progressLabel(todos) {
			let done = 0;
			let active = 0;
			for (const item of todos) {
				if (item.status === "completed") done += 1;
				else if (item.status === "in_progress") active += 1;
			}
			const pending = todos.length - done - active;
			return [
				...(done > 0 ? [done + " 已完成"] : []),
				...(active > 0 ? [active + " 进行中"] : []),
				...(pending > 0 ? [pending + " 待处理"] : [])
			].join(" · ");
		}

		/**
		 * 滑动窗口：挑出应该在紧凑模式里显示的那几项的下标。
		 *
		 * 锚点「当前项」= 第一个 `in_progress`；没有就取第一个 `pending`（清单刚写好、
		 * 还没开工）；全都 `completed` 就只回最后一项，表示「收尾在这儿」。
		 * 向上取最近的 `completed`、向下取最近的 `pending`，各自没有就省掉那一行。
		 * @param todos - 当前整表快照。
		 * @returns 要显示的下标数组，顺序即渲染顺序。
		 */
		function compactRows(todos) {
			if (todos.length === 0) return [];

			const active = todos.findIndex((item) => item.status === "in_progress");
			const pending = todos.findIndex((item) => item.status === "pending");

			// 全部完成：窗口只剩最后一格，不再往前带一行。
			if (active < 0 && pending < 0) return [todos.length - 1];

			const current = active >= 0 ? active : pending;

			let previous = -1;
			for (let i = current - 1; i >= 0; i -= 1) {
				if (todos[i] !== undefined && todos[i].status === "completed") {
					previous = i;
					break;
				}
			}

			let next = -1;
			for (let i = current + 1; i < todos.length; i += 1) {
				if (todos[i] !== undefined && todos[i].status === "pending") {
					next = i;
					break;
				}
			}

			return [previous, current, next].filter((index) => index >= 0);
		}

		/** 一行任务：状态点 + 文本。状态点由 CSS 按 `data-status` 上色与动画。 */
		function TodoRow({ item }) {
			return h(
				"li",
				{ className: C.item, "data-status": item.status },
				h("span", {
					className: C.glyph,
					role: "img",
					"aria-label": statusLabel(item.status)
				}),
				h("span", { className: C.content }, item.content)
			);
		}

		/**
		 * 常驻面板本体。
		 * @param props - slot 注入的 keyed hooks；`useProjection` 是会话投影的读取面
		 * （开放键空间，宿主注册什么键这里就能读什么键）。
		 */
		function StickyTodoDock({ useProjection }) {
			const todos = useProjection("todosSticky") ?? [];
			const [mode, setMode] = React.useState(readMode);
			const empty = todos.length === 0;

			// 记住最近一次的非最小化模式，最小化后点回来用它。
			const lastBody = React.useRef(mode === MODE_MINIMIZED ? MODE_COMPACT : mode);
			if (mode !== MODE_MINIMIZED) lastBody.current = mode;

			// 只有真有内容要显示时才打标记去隐藏官方那枚；空态不动官方（官方空态本来也
			// 什么都不渲染），卸载时摘掉标记，本插件一旦失效官方面板自动回来。
			React.useEffect(() => {
				if (empty) return undefined;
				const root = document.documentElement;
				root.setAttribute(LIVE_ATTR, "on");
				return () => {
					root.removeAttribute(LIVE_ATTR);
				};
			}, [empty]);

			const select = (next) => {
				setMode(next);
				writeMode(next);
			};
			const toggleMinimize = () =>
				select(mode === MODE_MINIMIZED ? lastBody.current : MODE_MINIMIZED);
			const toggleAll = () => select(mode === MODE_EXPANDED ? MODE_COMPACT : MODE_EXPANDED);

			let indices;
			if (empty || mode === MODE_MINIMIZED) indices = [];
			else if (mode === MODE_EXPANDED) indices = todos.map((_, index) => index);
			else indices = compactRows(todos);

			return h(
				"section",
				{
					className: C.root,
					"data-testid": "todo-sticky-panel",
					"data-mode": mode,
					"data-empty": empty ? "true" : "false",
					"aria-label": "任务"
				},
				h(
					"div",
					{ className: C.body },
					h(
						"div",
						{ className: C.header },
						h(
							"button",
							{
								type: "button",
								className: C.headerMain,
								"aria-expanded": empty || mode === MODE_MINIMIZED ? "false" : "true",
								title: empty ? "等待列出任务清单" : mode === MODE_MINIMIZED ? "展开" : "最小化",
								onClick: toggleMinimize,
								disabled: empty
							},
							h(
								"span",
								{ className: C.lead, "aria-hidden": true },
								h(primitives.IconChecklistOutlineRegular, {})
							),
							h("span", { className: C.title }, "任务"),
							h(
								"span",
								{ className: C.progress },
								empty ? "尚未列出清单" : progressLabel(todos)
							),
							empty
								? null
								: h(
										"span",
										{ className: C.chevron, "aria-hidden": true },
										mode === MODE_MINIMIZED
											? h(primitives.IconChevronUpOutlineRegular, {})
											: h(primitives.IconChevronDownOutlineRegular, {})
									)
						),
						empty
							? null
							: h(
									"button",
									{
										type: "button",
										className: C.mode,
										"data-testid": "todo-sticky-mode",
										title:
											mode === MODE_EXPANDED ? "收起为滑动窗口" : "展开全部任务",
										onClick: toggleAll
									},
									mode === MODE_EXPANDED ? "收起" : "全部"
								)
					),
					empty
						? h(
								"div",
								{ className: C.hint, "data-testid": "todo-sticky-empty" },
								"等待列出任务清单…"
							)
						: indices.length === 0
							? null
							: h(
									"ul",
									{ className: C.list, "data-testid": "todo-sticky-list" },
									indices.map((index) =>
										h(TodoRow, {
											key: String(index) + ":" + String(todos[index].content),
											item: todos[index]
										})
									)
								)
				)
			);
		}

		/**
		 * 浏览器半入口。
		 * @param ctx - 客户端上下文，携带 `slots`。
		 */
		function apply(ctx) {
			ensureStyle();
			ctx.slots.inject("conversation.input.dock", () =>
				ctx.slots.register(
					{
						name: "conversation.input.dock",
						id: "todo-sticky",
						// 排在官方那枚（id "todo", order 0）之前
						order: -10
					},
					StickyTodoDock
				)
			);
		}

		exports.name = "dsh-todo-sticky";
		exports.inject = ["slots"];
		exports.apply = apply;
		return module.exports;
	}
});
