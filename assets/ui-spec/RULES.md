# UI Spec → Prefab：组件规则说明

`tools/ui-spec-to-prefab.ts` 在根据 `*.json` 创建节点与基础组件（如 `cc.Sprite`）之后，会**可选地**加载一份 **JSON 规则**，按**图层名正则**追加组件并设置属性，再调用 MCP 写入场景并最终生成 Prefab。

## 规则文件放哪里

- 与 UI Spec 同名、同目录：例如 `testView.json` 旁放置 **`testView.rules.json`**，会自动加载。
- 或命令行指定：`npm run ui-spec:prefab -- path/to/spec.json --rules path/to/custom.rules.json`

## JSON 格式（`version`: 1）

| 字段 | 说明 |
|------|------|
| `layerNameRules` | 规则数组，**按顺序**逐条尝试；一条内可 `addComponents` 多条再 `setProperties`。 |
| `regex` | 对 PSD 图层的 **`name`** 做 `RegExp` 匹配。 |
| `flags` | 可选，传给 `new RegExp(regex, flags)`，如 **`"i"`** 表示忽略大小写。不要用 `(?i)` 内联写法（JavaScript 不支持）。 |
| `when` | 可选：`pixel` \| `text` \| `group` \| `any`（缺省为 `any`）。 |
| `addComponents` | 引擎组件类型名，如 `cc.Button`、`cc.Layout`（与 MCP `component_add_component` 一致）。 |
| `setProperties` | 每条对应一次 `component_set_component_property`：`componentType`、`property`、`propertyType`、`value`。 |

`propertyType` / `value` 的写法与 **cocos-mcp-server** 里 `set_component_property` 工具说明一致（如 `number`、`color`、`size`、`spriteFrame` 等）。

## 与「命名 btn → Button」的关系

- **整组按钮**：`"when": "group"` + `"regex": "btn", "flags": "i"`，在**组节点**上挂 `cc.Button`（如 `GrpBtn`），子节点放 Sprite / Label，适合「父组可点」。
- **单图按钮**：`"when": "pixel"` + 名字含 `btn`，在**单个像素图层**上挂 `cc.Button`（不要与组规则同时命中同一套 UI，避免重复 Button）。
- 若你希望按钮与底图分离（父节点 Button、子节点 Sprite），需要更复杂规则（例如按路径分组），可再扩展脚本或拆图层结构。

## MCP 是否会直接读 Markdown？

不会。MCP 只执行**结构化工具调用**。约定是：**人写/维护规则 JSON（或你们已有 Markdown 定义经脚本转成 JSON）→ 本地脚本解析 → 调 MCP**。若坚持用 Markdown 描述规则，需要增加一步「MD → rules JSON」的解析器。
