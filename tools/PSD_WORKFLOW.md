# PSD → Cocos Creator 预制体自动化方案

## 方案概述

美术同学的 PSD 文件可以直接转换为 Cocos Creator 预制体，无需手动搭建 UI！

## 工作流程

```
PSD 文件
    ↓
解析图层结构
    ↓
导出图片资源
    ↓
生成节点定义
    ↓
调用 MCP 工具
    ↓
创建预制体 + MD 定义
```

## 对应关系

| PSD 元素 | Cocos Creator | 说明 |
|---------|---------------|------|
| 图层 | Node | 每个图层创建一个节点 |
| 图层组 | 父子节点 | 保持层级结构 |
| 图层位置 | position | 自动转换坐标系 |
| 图层尺寸 | contentSize | UITransform 组件 |
| 文字图层 | Label | 自动提取文本内容 |
| 图片图层 | Sprite | 导出为 PNG 资源 |
| 按钮图层 | Button | 检测 "btn/button" 关键字 |
| 输入框图层 | EditBox | 检测 "input/textfield" 关键字 |
| 图层可见性 | active | 同步显示状态 |
| 图层不透明度 | opacity | 同步透明度 |

## 使用方法

### 方式一：完整转换（推荐）

```bash
cd tools
npx tsx psd-to-prefab-full.ts ../design/UI.psd ../assets
```

这会自动完成：
1. 解析 PSD 文件
2. 导出所有图层图片
3. 生成预制体
4. 生成 MD 定义文件

### 方式二：仅生成 MD

```bash
npx tsx psd-to-prefab-full.ts ../design/UI.psd ../assets --md-only
```

先修改 MD，再手动生成预制体。

## 命名规范

为了让工具自动识别组件类型，请使用以下命名：

| 组件类型 | 图层命名示例 |
|---------|-------------|
| 按钮 | `btn_ok`, `button_close`, `BuyButton` |
| 输入框 | `input_name`, `textfield_email` |
| 开关 | `toggle_sound`, `checkbox_music` |
| 滑块 | `slider_volume`, `slider_progress` |
| 滚动视图 | `scrollview_list` |

## 输出示例

### 输入 (PSD)
```
UI_MainMenu.psd
├── Background (图层)
├── Logo (图层)
├── Buttons (组)
│   ├── btn_start (图层)
│   └── btn_settings (图层)
└── Title (文字图层)
```

### 输出 (预制体)
```
UI_MainMenu.prefab
├── Background (Sprite)
├── Logo (Sprite)
├── btn_start (Button)
├── btn_settings (Button)
└── Title (Label)
```

### 输出 (MD 定义)
```markdown
# 预制体定义: UI_MainMenu

## 节点树
```
UI_MainMenu
├── Background (1920x1080)
├── Logo (200x100)
├── btn_start (160x60) - Button
├── btn_settings (160x60) - Button
└── Title (400x80) - Label
```

## 坐标转换

- **PSD**: 左上角为原点 (0,0)
- **Cocos**: 左下角为原点 (0,0)

工具会自动处理 Y 轴翻转：
```javascript
cocosY = psdHeight - psdY
```

## 资源路径

导出的图片会按以下规则命名：

```
assets/textures/psd/
├── UI_MainMenu-Background.png
├── UI_MainMenu-Logo.png
├── UI_MainMenu-Buttons-btn_start.png
└── UI_MainMenu-Buttons-btn_settings.png
```

## 常见问题

### Q: 有些图层没有正确转换？

A: 检查图层命名是否包含特殊字符，建议使用英文命名。

### Q: 文字显示不正确？

A: 确保文字图层已栅格化，或者修改 MD 中的字体设置。

### Q: 图片资源很大？

A: 可以在 Photoshop 中优化图层，或者使用图集工具打包。

### Q: 按钮没有检测到？

A: 确保图层名称包含 "btn" 或 "button"（不区分大小写）。

## 进阶功能

### 1. 智能组件识别

通过图层命名自动识别组件类型：
```javascript
if (name.includes('btn')) {
    // 添加 Button 组件
}
```

### 2. 九宫格设置

在图层名称中添加尺寸信息：
```
bg_border_9.9.9.9  // 左,右,上,下 边距
```

### 3. 自定义属性

在 MD 中添加自定义组件属性：
```yaml
components:
  - type: cc.Button
    properties:
      _transition: 2
      _normalColor: #4A90E2
      __customEvent__: "onButtonClick"  // 自定义事件
```

### 4. 批量处理

处理整个文件夹的 PSD：
```bash
for psd in design/**/*.psd; do
    npx tsx psd-to-prefab-full.ts "$psd" ../assets
done
```

## 工具对比

| 方式 | 优点 | 缺点 |
|------|------|------|
| **PSD → 预制体** | 自动化、快速、保持设计还原 | 需要规范命名 |
| **手写 MD → 预制体** | 灵活、可精确控制 | 耗时、容易出错 |
| **手动搭建** | 完全控制 | 非常耗时 |

## 最佳实践

1. **设计阶段**
   - 使用清晰的图层命名
   - 合理组织图层结构
   - 添加必要的组件标记

2. **转换阶段**
   - 先生成 MD 预览
   - 检查节点结构是否正确
   - 调整组件属性

3. **优化阶段**
   - 合并相似的图层
   - 使用图集减少 DrawCall
   - 添加动画和交互

## 总结

✅ **可以直接从 PSD 生成预制体！**

这个方案连接了设计（PSD）和开发（Cocos Creator），大大提高了 UI 制作效率。

美术同学只需要：
1. 按照命名规范设计 PSD
2. 运行转换脚本
3. 在 Cocos Creator 中验证

开发同学只需要：
1. 检查生成的 MD 定义
2. 添加自定义逻辑
3. 测试和优化
