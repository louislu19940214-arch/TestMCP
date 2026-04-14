# PSD → Prefab：使用说明与交付清单

本文说明：**把本工作流交给其他同事时，对方需要具备什么、仓库里要有什么、按什么顺序执行脚本**。更完整的美术规范与协作对话方式见 **`PSD到Prefab工作流指南.md`**。

---

## 一、推荐阅读顺序

1. **`docs/PSD到Prefab工作流指南.md`** — 美术 PSD 规范、前端整体工作流、与 AI 协作方式。  
2. **本文** — 环境、交付物、命令清单、排错。

---

## 二、对方需要具备什么（环境）

| 项目 | 说明 |
|------|------|
| **本仓库** | 推荐 **Git 克隆整仓**（见下文「应持有文件」）；不要只拷零散脚本，否则扩展、路径、meta 易缺失。 |
| **Cocos Creator** | 与项目版本一致（如 **3.8.x**），能打开本工程。 |
| **Node.js** | **LTS** 即可，用于执行 `tools/` 下脚本（`npm install` / `npm run …`）。 |
| **cocos-mcp-server** | 已放在仓库 **`extensions/cocos-mcp-server/`**；在编辑器中 **启用扩展**，并能在面板里 **启动 MCP 服务**（端口与 Cursor 配置一致，如 **8585**）。 |
| **Cursor / VS Code（可选）** | 若要用 AI 辅助改规则、排错，需配置 MCP 指向 `http://127.0.0.1:8585/mcp`（端口以实际为准）。**纯命令行生成 Prefab 可不装 Cursor**。 |

---

## 三、应持有 / 同步哪些文件（交付清单）

**推荐方式：持有整个工程仓库**（与你们 `origin` 同步），至少保证下列路径存在且可被打开、执行：

### 1. 必须（脚本与依赖）

| 路径 | 作用 |
|------|------|
| **`tools/package.json`** | 定义 `psd:parse`、`ui-spec:prefab` 等脚本与依赖。 |
| **`tools/*.ts`** | 含 `psd-parse.ts`、`ui-spec-to-prefab.ts` 等实现。 |
| **`tools/node_modules/`** | 本地执行 **`cd tools && npm install`** 生成；**不必**单独交付，对方自己安装即可。 |

### 2. 必须（编辑器与 MCP）

| 路径 | 作用 |
|------|------|
| **`extensions/cocos-mcp-server/`** | MCP 插件源码/构建产物；编辑器内启用并启动服务。 |

### 3. 必须（资源与中间产物约定目录）

| 路径 | 作用 |
|------|------|
| **`assets/Psd/`** | 放 PSD（路径可自定，解析命令里写绝对或相对路径即可）。 |
| **`assets/Texture/`** | 放与图层名对应的 **png/jpg**；需已被 Cocos **导入**（存在 **`.meta`**），否则无法解析 SpriteFrame uuid。 |
| **`assets/ui-spec/`**（建议） | 输出 **`*.json` / `*.md`**；可选 **`*.rules.json`** 组件规则。 |
| **`assets/prefabs/`**（建议） | 输出 **`db://assets/prefabs/…`** 对应的 prefab 文件。 |

### 4. 建议一并交付的文档

| 路径 | 作用 |
|------|------|
| **`docs/PSD到Prefab工作流指南.md`** | 规范与工作流总览。 |
| **`docs/PSD到Prefab-使用说明与交付清单.md`** | 本文。 |
| **`assets/ui-spec/RULES.md`** | `*.rules.json` 字段说明与示例。 |

### 5. 不必单独拷贝给对方的

- **`library/`、`temp/`、`local/`** 等编辑器生成目录（各人本机自动生成）。  
- **`tools/node_modules/`**（对方自己 `npm install`）。

---

## 四、对方机器上的一次性准备

```bash
# 1. 克隆仓库并进入工程根目录（示例）
cd <项目根目录>

# 2. 安装脚本依赖
cd tools
npm install
cd ..
```

在 **Cocos Creator** 中：

1. 打开本项目。  
2. **扩展管理** 中启用 **Cocos MCP Server**。  
3. **扩展 → Cocos MCP Server**，设置端口（如 **8585**），点击 **启动服务**（或开启自动启动）。

若 MCP 端口不是 **8585**，生成前在终端设置（PowerShell 示例）：

```powershell
$env:COCOS_MCP_URL = "http://127.0.0.1:你的端口/mcp"
```

---

## 五、日常操作：从 PSD 到 Prefab（命令清单）

以下均在 **`tools/`** 目录下执行（先 `cd tools`）。

### 步骤 1：PSD → UI Spec（JSON + 可选 MD）

```bash
npm run psd:parse -- ..\assets\Psd\你的界面.psd --out ..\assets\ui-spec\你的界面.json --md --origin center
```

- 输出：`assets/ui-spec/你的界面.json`（及可选 `你的界面.md`）。  
- **`--origin`**：`center` 与 `topleft` 二选一，团队内统一即可。

### 步骤 2（可选）：组件规则

在与 JSON **同目录、同主文件名** 放置 **`你的界面.rules.json`**，或见 **`assets/ui-spec/RULES.md`** 编写规则。  
不放置则仅按默认逻辑生成节点与 Sprite/Label，不额外加 Button 等。

### 步骤 3：UI Spec + MCP → Prefab

1. **Cocos 已打开本项目**，MCP **已启动**。  
2. 若上次在场景里生成了 **`你的界面Root`** 等同名节点，先在场景里 **删除**，避免重名。  

```bash
npm run ui-spec:prefab -- ..\assets\ui-spec\你的界面.json --prefab db://assets/prefabs\你的界面_fromPsd.prefab
```

可选参数：

- **`--texture-dir`**：贴图目录绝对路径（默认：`ui-spec` 旁的 `../Texture`）。  
- **`--rules`**：指定规则 JSON 路径（默认会尝试加载同名 `你的界面.rules.json`）。

---

## 六、交给他人时的「最小交接话术」

你可以直接转发下面三句：

1. **克隆本仓库**，安装 Node，在 **`tools`** 里执行 **`npm install`**。  
2. 用 **Cocos 打开工程**，启用并 **启动 cocos-mcp-server**（端口与 `COCOS_MCP_URL` 一致）。  
3. PSD 放 **`assets/Psd/`**，贴图放 **`assets/Texture/`**，按 **`docs/PSD到Prefab-使用说明与交付清单.md`** 第五节两条命令跑即可。

---

## 七、常见问题（给对方备用）

| 现象 | 处理方向 |
|------|-----------|
| 图片 **紫/洋红** | Sprite 需 **SpriteFrame 子资源 uuid**；当前脚本从 **`.meta`** 读取。确认贴图已导入、`.meta` 存在。 |
| **找不到父节点** / 跳过 | 检查 `*.json` 里 **`parentPath`** 与组层级；先保证 **组图层在子图层之前** 创建（脚本已按深度排序，一般无需手改）。 |
| **规则不生效** | 正则不要用 `(?i)`，改用 **`"flags": "i"`**；`when` 与图层 **`kind`**（`group` / `pixel` / `text`）一致。 |
| MCP **连接失败** | Cocos 是否打开对应工程、扩展是否启动、端口与 **`COCOS_MCP_URL`** 是否一致。 |

---

## 八、与主工作流文档的关系

| 文档 | 侧重 |
|------|------|
| **`PSD到Prefab工作流指南.md`** | 美术怎么画、前端怎么配合 MCP、怎么和 AI 沟通。 |
| **`PSD到Prefab-使用说明与交付清单.md`（本文）** | **谁能跑、要拿什么、敲哪几条命令**。 |

---

*若团队将工程发布为模板仓库，可在根目录 `README.md` 增加指向 `docs/` 的两篇链接，便于新人入口统一。*
