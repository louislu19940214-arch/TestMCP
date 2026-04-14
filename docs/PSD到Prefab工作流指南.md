# PSD → Prefab 工作流指南（美术规范 + 前端操作 + MCP）

本文档整理自项目内 **PSD 解析 → 中间 JSON → MCP 生成 Prefab** 的实践，供美术与前端对齐使用。

**给他人安装与跑脚本时**，请另阅：**`PSD到Prefab-使用说明与交付清单.md`**（环境、须同步的目录、命令清单）。

---

## 一、美术同学：PSD 制作建议规范

### 1. 画布与色彩

- **分辨率**：与游戏内 UI 设计分辨率一致（如 750×1334、1920×1080），便于坐标与 Prefab 中 `UITransform` 尺寸对照。
- **色彩模式**：优先 **RGB、8 位**，结构尽量简单；少用复杂智能对象、剪贴蒙版、混合模式叠特效（解析与还原成本高）。

### 2. 图层结构与节点

- **层级**：MVP 阶段建议 **少组套组**；背景 + 按钮等用 **清晰命名的平级或一层组** 即可。
- **顺序**：Photoshop 中 **越靠下的图层越在底层**；生成脚本会 **保持解析顺序** 作为子节点顺序，影响叠放关系。
- **组（文件夹）**：需要容器时再用组；组内子图层命名仍要可读。

### 3. 命名规范（强烈建议）

命名直接影响 **贴图匹配** 与 **规则命中**（如按钮自动加 `cc.Button`）。

| 类型 | 建议 | 说明 |
|------|------|------|
| 像素层 / 背景 | 与导出图 **文件名一致**（不含扩展名） | 如资源为 `common_btn_red.png`，图层名建议 `common_btn_red`。 |
| 按钮 | 名称中包含 **`btn`** 或团队约定前缀 | 前端可在 `*.rules.json` 里用正则 `btn` + `flags: "i"` 匹配并挂 `cc.Button`。 |
| 文本 | 统一前缀如 `txt_` | 便于后续扩展为 `cc.Label` 规则。 |
| 九宫格 | 统一前缀如 `9s_` | 便于后续扩展 `Sprite` 为 Sliced 等。 |
| 避免 | 仅中文且无对应 `中文.png`** | 若无同名贴图，Sprite 将无法自动绑定。 |

**字符**：尽量使用 **英文、数字、下划线**；避免随意空格与特殊符号（脚本会做一定 sanitize，但与资源文件名对齐最简单）。

### 4. 资源交付

- 切图或整图放在工程约定目录，如 **`assets/Texture/`**，文件名与图层命名规则一致。
- 确保 Cocos 已 **导入资源**（存在 **`.meta`**），否则无法从 meta 读取 **SpriteFrame 子资源 uuid**。

### 5. 与程序对齐的「可还原子集」

- 复杂文字样式、渐变、描边等可能无法 100% 用 `Label` 还原，需提前约定 **降级策略**（例如烘焙成图）。
- 需要可点击区域时：**图层名可识别为按钮 + 单独一张按钮图**，比纯矢量蒙版更易自动化。

---

## 二、前端同学：拿到 PSD 后的完整工作流

### 1. 环境准备

1. **Cocos Creator** 打开本项目（版本与 `CLAUDE.md` 一致，如 3.8.x）。
2. 安装并启用扩展 **`cocos-mcp-server`**（位于 `extensions/cocos-mcp-server/`）。
3. 菜单 **扩展 → Cocos MCP Server**，配置端口（示例 **8585**），点击 **启动服务**；可选开启 **自动启动**。
4. **Cursor（或 VS Code）** 中配置 MCP，指向 HTTP 地址，例如：

   `http://127.0.0.1:8585/mcp`

   本项目也可使用仓库内 `mcp.json` 等与 Cursor 联动的配置（以你本机实际为准）。

5. **Node.js**：用于执行 `tools/` 下脚本。

### 2. 贴图与 PSD 路径约定（示例）

- PSD：`assets/Psd/你的界面.psd`
- 贴图：`assets/Texture/`（与 PSD 图层名对应的 `png` / `jpg`）
- 中间产物：`assets/ui-spec/你的界面.json`、可选 `你的界面.md`、`你的界面.rules.json`

### 3. 命令行工作流（三步）

在仓库根目录打开终端，进入 `tools`：

```bash
cd tools
npm install
```

**步骤 A：PSD → UI Spec（JSON + 可选 MD）**

```bash
npm run psd:parse -- ..\assets\Psd\你的界面.psd --out ..\assets\ui-spec\你的界面.json --md --origin center
```

说明：

- **`--origin center`**：坐标相对画布中心（与脚本内换算一致）；也可改为 **`topleft`**，团队内需统一。
- 默认 **不读入图层像素**（更快）；若要做切图流水线再加 **`--include-image-data`**。

**步骤 B（可选）：组件规则 `*.rules.json`**

在与 `你的界面.json` **同目录、同主文件名** 放置 **`你的界面.rules.json`**，用于按图层名正则 **追加组件**（如 `btn` → `cc.Button`）。  
格式与说明见：**`assets/ui-spec/RULES.md`**。

注意：JavaScript 正则 **不支持** `(?i)xxx` 内联忽略大小写，请使用：

```json
"regex": "btn",
"flags": "i"
```

**步骤 C：UI Spec + MCP → Prefab**

1. 确认 Cocos 已打开项目且 **MCP 服务已启动**。
2. 若上次生成在场景里留下了根节点 **`xxxRoot`**，可在场景中 **删除** 再生成，避免重名。
3. 执行：

```bash
npm run ui-spec:prefab -- ..\assets\ui-spec\你的界面.json --prefab db://assets\prefabs\你的界面_fromPsd.prefab
```

可选参数：

- **`--texture-dir`**：贴图文件夹绝对路径（默认取 `ui-spec` 旁的 `../Texture`）。
- **`--rules`**：指定规则 JSON；不指定时若存在同名 `你的界面.rules.json` 会自动加载。

环境变量（可选）：

- **`COCOS_MCP_URL`**：覆盖默认 MCP 地址（默认 `http://127.0.0.1:8585/mcp`）。

### 4. 与 AI（Cursor）协作时怎么对话、怎么生成 Prefab

AI **不会直接替你点编辑器**，但可以帮你：**改脚本、改规则、查日志、组织命令**。推荐你这样描述需求：

1. **给上下文**  
   - PSD 路径、贴图目录、目标 Prefab 的 `db://` 路径。  
   - 当前 MCP 端口、是否已启动 Cocos MCP Server。

2. **明确目标**  
   - 例如：「解析 `assets/Psd/testView.psd`，生成 `testView.json`，再生成 `db://assets/prefabs/testView_fromPsd.prefab`。」

3. **规则与命名**  
   - 例如：「图层名包含 `btn` 时自动加 `cc.Button`，规则写在 `testView.rules.json`。」

4. **排错**  
   - 若 **图片紫块**：多为 SpriteFrame 写成了 `db://` 路径而非 **meta 里 sprite-frame 的 uuid**；当前 `ui-spec-to-prefab` 已从 `.meta` 读取 uuid。  
   - 若 **规则未生效**：检查正则是否在 JS 中合法（使用 `flags: "i"` 等）。

你也可以直接说：「按仓库里 `docs/PSD到Prefab工作流指南.md` 跑一遍 testView」让 AI 按文档执行或检查。

---

## 三、相关文件速查

| 路径 | 作用 |
|------|------|
| `tools/psd-parse.ts` | PSD → `assets/ui-spec/*.json` |
| `tools/ui-spec-to-prefab.ts` | JSON + MCP → Prefab；读取 `*.rules.json` |
| `tools/package.json` | 脚本：`psd:parse`、`ui-spec:prefab` |
| `tools/README.md` | 工具安装与命令摘要 |
| `assets/ui-spec/RULES.md` | `*.rules.json` 字段说明 |
| `extensions/cocos-mcp-server/README.md` / `README.EN.md` | MCP 插件能力与端口配置 |

---

## 四、版本与维护

- 文档随流水线迭代可继续补充：**复杂布局规则**、**JSON→Markdown→MCP** 的二次封装、**CI 中自动化** 等。
- 若团队规范有更新，请同步修改 **美术命名约定** 与 **`RULES.md` 中的示例**。

---

*文档生成说明：基于本项目当前脚本与 cocos-mcp-server 行为整理；实际以编辑器与插件版本为准。*
