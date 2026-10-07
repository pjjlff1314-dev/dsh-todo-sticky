/**
 * dsh-todo-sticky — 宿主半（node half）。
 *
 * 这一半干三件事，互不依赖：
 *
 * ## 一、让面板不被清空
 *
 * 官方 `@deepseek-ai/dsh-tool-todo` 注册的 `todos` 投影有这么一条：
 *
 * ```js
 * apply: (state, event) => {
 *   if (event.type === "todo/write") return event.data.todos;
 *   if (event.type === "turn/start") return null;   // ← 每一轮开始就清空
 *   return state;
 * }
 * ```
 *
 * 于是官方那个输入框上方的任务面板只在「写过清单的那一轮」里存在。这一半在同一个
 * 投影表里再注册一个**独立键** `todosSticky`，折叠同样的 `todo/write` 事件，但
 * **不在 `turn/start` 清空**——它就是「这个会话最后一次的任务清单」，一直留着。
 * 浏览器半（lib/client.js）把它画在输入框上方。注意它仍然是**会话级**的：每个
 * 对话各有一份，互不继承。
 *
 * ## 二、软强制：任务清单纪律
 *
 * 注册一段系统提示词 section（`order: 700`），把「多步任务必须先 `todo_write` 列
 * 清单、切换步骤要在同一次调用里完成两个状态变更」写成硬性纪律。
 *
 * ## 三、硬强制：跳步拦截
 *
 * 纪律只是「说出来」；只靠它约束不住时，这一半还在 `tools/post-execute` 上把一道
 * 门：**同一轮里已经连续两个步骤调用过工具、却还没有任何清单**时，直接把一条提醒
 * 塞进进入模型的消息里（`additionalContexts`），当场要求补清单。
 *
 * 提醒走的是平台官方做法（同 `@deepseek-ai/dsh-repeat-tool-reminder`）：
 * `additionalContexts` + 一条**带自定义 `source.kind` 的 UserMessage**。那个 kind
 * 是有用的——官方源码注释写着「an unlabeled context would render as a user prompt
 * in derived history」，所以绝不能省，否则提醒会在对话里伪装成你说的话。
 *
 * 没有改官方任何东西：官方 `todos` 键、官方组件、官方行为原样保留。
 *
 * @module dsh-todo-sticky
 */
import { randomUUID } from "node:crypto";

export const name = "dsh-todo-sticky";

/** 依赖投影表与提示词注册表；缺任一则整个插件不激活，而不是半死不活。 */
export const inject = ["sessionProjections", "systemPrompt"];

/**
 * 整表快照的校验器：形状是官方那套 `TodoItem[] | null`（pre-first-write 为 null）。
 *
 * 刻意手写而不是引入 `zod`：投影表对这个对象只调用 `.parse()`（见
 * `@deepseek-ai/dsh-session-projection` 的 snapshot / checkpoint / restore 三处，
 * 无 `safeParse`、无 `instanceof`、无 `_def` 读取），所以一个带 `parse` 的对象就是
 * 完整可用的契约。这样插件零运行时依赖，也不会在 `link:` 安装下出现裸模块解析问题。
 *
 * 只做形状级校验、不剥键、不复制：原始数组引用原样返回，`Object.is` 变更判定不被
 * 干扰；字段级约束已经由官方 `todo/write` invariant 在写入时把过了。
 */
const todosSchema = {
	parse(value) {
		if (value === null || value === undefined) return null;
		if (!Array.isArray(value)) {
			throw new Error("todosSticky must be an array of todo items or null");
		}
		for (const item of value) {
			if (item === null || typeof item !== "object" || typeof item.content !== "string") {
				throw new Error("todosSticky items must be objects carrying string content");
			}
		}
		return value;
	}
};

/**
 * 「任务清单纪律」在提示词里的位置。
 *
 * 对齐官方 `SECTION_ORDERS`：`PLAN_POLICY = 500`、`TEAM_POLICY = 600`、
 * `PTC_ONLY = 800`，而所有工具说明都在 `1000+`。700 落在策略带里、排在工具说明
 * 之前——够醒目，又不抢身份（-1000）与人设（0）的位置。
 */
const MANDATE_ORDER = 700;

/**
 * 强制清单的正文。
 *
 * 写具体、写可执行：只说「记得用 todo_write」没用，得把「什么时候必须建」「怎么
 * 更新」说到模型无法绕过。最后一句留了纯问答的出口，免得一问一答也被逼出清单。
 */
const MANDATE = [
	"## 任务清单纪律（强制）",
	"",
	"只要一件事需要**两个或更多步骤**（要连续调用工具，或要跨多轮才能做完），就**必须先调用 `todo_write` 把完整步骤列成清单，然后才开始动手**。不允许先干活后补清单，也不允许把多步工作拆成零散调用而不建清单。",
	"",
	"- 清单一次覆盖整件事的全过程，一步一条，用可验收的祈使句",
	"- 同一时刻**只允许一条** `in_progress`",
	"- 切换步骤时，**在同一次调用里**把上一步改成 `completed`、把下一步改成 `in_progress`——这样界面上的进度窗口才会向前滚动",
	"- 每完成一步立刻更新，不要攒到最后一次性写；最后一步也要标 `completed`",
	"- 只有**纯问答**（不调用任何工具、一次回复就结束）才可以不建清单；一旦发现要动工具，先补上清单再继续"
].join("\n");

/**
 * 硬强制门的阈值：同一轮里「至少调用过一次工具」的步骤数。
 *
 * 取 2 是照着纪律原文定的——纪律里的触发条件是「需要两个或更多步骤（要连续调用
 * 工具）」。所以第 2 个动用工具的步骤还没清单，就是明确违反，此时提醒既准确又不
 * 啰嗦：纯问答轮次到不了这一步，单步任务也不会被误伤。
 */
const TOOL_STEP_THRESHOLD = 2;

/**
 * 提醒消息的 source.kind。
 *
 * **必须自定义**：官方 `repeat-tool-reminder` 的源码注释写得很清楚——
 * 「an unlabeled context would render as a user prompt in derived history」。
 * 用 `kind: "user"` 会在对话记录里伪装成用户发言。
 */
const REMINDER_SOURCE_KIND = "todo-sticky";

/** 拦截到违规时塞进去的正文。 */
function reminderText(toolSteps) {
	return [
		`⚠️ 本轮已经连续 ${toolSteps} 个步骤在调用工具，但还没有建立任务清单——这违反了「任务清单纪律（强制）」。`,
		"",
		"现在请立刻调用 `todo_write`：把整件事的完整步骤列出来（已经做完的步骤也要列出并标 `completed`，当前这一步标 `in_progress`），然后再继续动手。之后每完成一步，就在同一次调用里把状态往前推一格。"
	].join("\n");
}

/** 递归冻结一条新消息，发布后谁都改不动。 */
function deepFreeze(value) {
	if (value !== null && typeof value === "object") {
		for (const key of Object.keys(value)) deepFreeze(value[key]);
		Object.freeze(value);
	}
	return value;
}

/** 造一条带自定义 source 的用户角色消息（给模型看，不在对话里当成人说的话）。 */
function createReminder(toolSteps) {
	return deepFreeze({
		id: randomUUID(),
		role: "user",
		content: [{ type: "text", text: reminderText(toolSteps) }],
		source: {
			kind: REMINDER_SOURCE_KIND,
			form: "notice",
			summary: `任务清单未建立（本轮已 ${toolSteps} 个步骤调用工具）`
		}
	});
}

/** 把提醒挂到工具结果已有的 contexts 前面，保留下游原有的 source 与顺序。 */
function withReminder(decision, reminder) {
	const additionalContexts = [reminder, ...(decision.additionalContexts ?? [])];
	if (decision.kind === "block") {
		return { kind: "block", feedback: decision.feedback, additionalContexts };
	}
	return { ...decision, additionalContexts };
}

/**
 * 注册常驻投影、纪律提示词，以及跳步拦截门。
 *
 * 投影键与官方不冲突：键空间不同（`todos` vs `todosSticky`），互不干扰。
 * @param ctx - 携带 `sessionProjections` 与 `systemPrompt` 的注册上下文。
 */
export function apply(ctx) {
	ctx.sessionProjections.register({
		key: "todosSticky",
		stateSchema: todosSchema,
		init: () => null,
		apply: (state, event) => (event.type === "todo/write" ? event.data.todos : state),
		wire: {
			viewSchema: todosSchema,
			view: (state) => state
		},
		stateVersion: 1
	});

	ctx.systemPrompt.section({
		name: "todo-sticky/mandate",
		order: MANDATE_ORDER,
		text: MANDATE,
		// 正文里没有模板变量；关掉插值，免得正文中任何花括号被当成引用。
		interpolate: false
	});

	// ---- 跳步拦截门的每会话状态 ----
	// toolSteps 数的是「至少调用过一次工具的步骤」，不是工具调用次数：一个步骤里
	// 并行发 3 个工具调用仍然只算 1 步，这样阈值才对齐纪律里「两个或更多步骤」。
	const perSession = new Map();

	function stateFor(sessionId) {
		let state = perSession.get(sessionId);
		if (state === undefined) {
			state = { toolSteps: 0, stepOpened: false, hasList: false, reminded: false };
			perSession.set(sessionId, state);
		}
		return state;
	}

	ctx.on("session/disposed", (session) => {
		perSession.delete(session.id);
	});

	ctx.on("session/event", (session, event) => {
		const state = stateFor(session.id);
		if (event.type === "turn/start") {
			state.toolSteps = 0;
			state.stepOpened = false;
			state.hasList = false;
			state.reminded = false;
			return;
		}
		if (event.type === "step/start") {
			state.stepOpened = false;
			return;
		}
		if (event.type === "tool/call") {
			if (!state.stepOpened) {
				state.stepOpened = true;
				state.toolSteps += 1;
			}
			return;
		}
		if (event.type === "todo/write") {
			state.hasList = Array.isArray(event.data?.todos) && event.data.todos.length > 0;
			if (state.hasList) state.reminded = false;
		}
	});

	ctx.on("tools/post-execute", async (exec, _result, next) => {
		// 先让下游定案，再读状态：todo_write 是在工具执行期间落盘的，跑完才看得见。
		const downstream = await next();
		try {
			if (exec.agent === undefined) return downstream;
			const state = perSession.get(exec.agent.id);
			if (state === undefined) return downstream;
			if (state.hasList || state.reminded) return downstream;
			if (state.toolSteps < TOOL_STEP_THRESHOLD) return downstream;
			// 每轮最多提醒一次：提醒后模型要么补清单（hasList 转真、复位），要么继续
			// 硬干——那就等下一轮再说，不在这里刷屏。
			state.reminded = true;
			return withReminder(downstream, createReminder(state.toolSteps));
		} catch {
			// 提醒是增强，不是主流程：任何判断失败都放行原结果。
			return downstream;
		}
	});
}
