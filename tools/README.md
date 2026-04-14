# 预制体生成器使用说明

从 Markdown 定义自动生成 Cocos Creator 预制体，通过 MCP 服务器调用。

## 前置条件

1. **Cocos Creator 3.8+** 已打开项目
2. **cocos-mcp-server** 插件已安装并启动（端口 3000）
3. **Node.js** 环境

## 安装依赖

```bash
cd tools
npm install
```

## 使用方法

### 方式一：直接运行（推荐）

```bash
npm run generate
```

这将使用预定义的 `shopItemDefinition` 直接生成预制体。

### 方式二：从 MD 文件解析

1. 编辑 `assets/prefab-definitions/ShopItem.md`
2. 运行解析器：

```bash
npm run parse
```

这会生成 `prefab-calls.json`，包含所有 MCP 工具调用。

## 定义格式

预制体可以使用 TypeScript 对象或 Markdown 定义：

### TypeScript 对象格式

```typescript
{
  name: 'MyNode',
  parent: 'ParentNode',
  nodeType: '2DNode',
  size: [100, 100],
  position: [0, 0, 0],
  components: [
    {
      type: 'Sprite',
      properties: {
        spriteFrame: 'db://assets/textures/sprite.png'
      }
    }
  ]
}
```

### Markdown 格式

```markdown
# 预制体定义: ShopItem

## 元数据
- 保存路径: db://assets/prefabs/ShopItem.prefab

## 节点定义

### MyNode
```yaml
parent: Root
nodeType: 2DNode
size: [100, 100]
position: [0, 0, 0]
components:
  - type: Sprite
    properties:
      spriteFrame: db://assets/textures/sprite.png
```
```

## 支持的组件类型

- **基础**: `UITransform`, `Sprite`
- **文本**: `Label`, `RichText`
- **交互**: `Button`, `Toggle`, `Slider`
- **布局**: `Layout`, `Widget`
- **滚动**: `ScrollView`, `ScrollBar`
- **其他**: `Animation`, `ParticleSystem`, `Widget`

## 属性设置

### 颜色
```typescript
// Hex 字符串
color: '#FFFFFF'

// RGBA 对象
color: { r: 255, g: 255, b: 255, a: 255 }

// 数组
color: [255, 255, 255, 255]
```

### 向量
```typescript
position: [x, y, z]
contentSize: { width: 100, height: 100 }
```

### 资源引用
```typescript
spriteFrame: 'db://assets/textures/image.png'
prefab: 'db://assets/prefabs/item.prefab'
```

## 常见问题

### MCP 连接失败
确保 cocos-mcp-server 已启动：
1. 打开 Cocos Creator
2. 扩展 → Cocos MCP Server
3. 点击"启动服务器"

### 资源找不到
检查资源路径是否以 `db://assets/` 开头。

### 节点创建失败
确保父节点已创建。生成器会自动按层级顺序创建节点。

## 自定义生成器

编辑 `prefab-generator-v2.ts` 中的 `shopItemDefinition` 来创建你自己的预制体：

```typescript
const myPrefabDefinition = {
  name: 'MyPrefab',
  savePath: 'db://assets/prefabs/MyPrefab.prefab',
  nodes: [
    // ... 你的节点定义
  ]
};

await generator.buildFromDefinition(myPrefabDefinition);
```

## 示例

查看以下文件了解完整示例：
- `assets/prefab-definitions/ShopItem.md` - Markdown 定义
- `tools/prefab-generator-v2.ts` - TypeScript 定义
