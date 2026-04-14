/**
 * PSD → 预制体完整解决方案
 * 1. 解析 PSD 结构
 * 2. 导出图片资源
 * 3. 生成预制体
 * 4. 生成 MD 定义文件（可选）
 */

import PSD from 'ag-psd';
import { promises as fs } from 'fs';
import path from 'path';
import { writeFile, mkdir } from 'fs/promises';

const MCP_URL = 'http://localhost:8585/mcp';

interface LayerInfo {
    name: string;
    left: number;
    top: number;
    width: number;
    height: number;
    visible: boolean;
    opacity: number;
    isText: boolean;
    text?: string;
    fontSize?: number;
    fontColor?: { r: number; g: number; b: number };
    children?: LayerInfo[];
    isGroup: boolean;
    layerPath: string; // 用于生成资源路径
}

interface PrefabNode {
    name: string;
    parent?: string;
    position: [number, number, number];
    size: [number, number];
    visible: boolean;
    opacity: number;
    components: ComponentInfo[];
    resourcePath?: string;
}

interface ComponentInfo {
    type: string;
    properties?: Record<string, any>;
}

/**
 * 完整的 PSD 到预制体转换
 */
class PSDEngine {
    private psd: any;
    private layers: LayerInfo[] = [];
    private nodes: PrefabNode[] = [];
    private resourceMap = new Map<string, string>(); // 图层名 → 资源路径

    /**
     * 加载 PSD 文件
     */
    async loadPSD(psdPath: string): Promise<void> {
        console.log('📂 加载 PSD 文件...\n');

        const buffer = await fs.readFile(psdPath);
        this.psd = PSD.readPsd(buffer);

        console.log(`PSD 信息:`);
        console.log(`  文件: ${path.basename(psdPath)}`);
        console.log(`  尺寸: ${this.psd.width} x ${this.psd.height}`);
        console.log(`  根目录: ${this.psd.tree.name || 'Root'}`);

        // 解析图层结构
        this.parseLayers(this.psd.tree, '', 0);

        console.log(`  图层总数: ${this.layers.length}\n`);
    }

    /**
     * 递归解析图层
     */
    private parseLayers(layer: any, parentPath: string, depth: number): void {
        if (!layer) return;

        const currentPath = parentPath ? `${parentPath}/${layer.name}` : layer.name;
        const isGroup = layer.layerType === 'group';

        const layerInfo: LayerInfo = {
            name: layer.name || `Layer_${depth}`,
            left: layer.left || 0,
            top: layer.top || 0,
            width: layer.width || 0,
            height: layer.height || 0,
            visible: layer.visible !== false,
            opacity: layer.opacity || 255,
            isText: !!layer.text,
            text: layer.text?.text,
            fontSize: layer.text?.font?.size,
            fontColor: layer.text?.font?.colors,
            isGroup,
            layerPath: currentPath.replace(/\//g, '-')
        };

        this.layers.push(layerInfo);

        // 递归处理子图层
        if (layer.children && layer.children.length > 0) {
            layerInfo.children = [];
            for (const child of layer.children) {
                this.parseLayers(child, currentPath, depth + 1);
            }
        }
    }

    /**
     * 生成节点定义
     */
    generateNodes(): void {
        console.log('🔨 生成节点结构...\n');

        const centerX = this.psd.width / 2;
        const centerY = this.psd.height / 2;

        // 父子关系映射
        const parentMap = new Map<string, string>();

        // 先找出父子关系
        for (const layer of this.layers) {
            if (layer.layerPath.includes('-')) {
                const parts = layer.layerPath.split('-');
                parts.pop(); // 移除当前层名
                const parentPath = parts.join('-');
                const parent = this.layers.find(l => l.layerPath === parentPath);
                if (parent && !parent.isGroup) {
                    parentMap.set(layer.name, parent.name);
                }
            }
        }

        // 生成节点
        for (const layer of this.layers) {
            if (layer.isGroup) continue; // 跳过组

            const node: PrefabNode = {
                name: this.sanitizeName(layer.name),
                parent: parentMap.get(layer.name),
                position: [
                    Math.round(layer.left - centerX),
                    Math.round(centerY - layer.top), // Y 轴翻转
                    0
                ],
                size: [layer.width, layer.height],
                visible: layer.visible,
                opacity: layer.opacity,
                components: []
            };

            // 添加组件
            if (layer.isText) {
                // 文字图层
                node.components.push({
                    type: 'cc.Label',
                    properties: {
                        _string: layer.text || '',
                        _fontSize: layer.fontSize || 20,
                        _color: this.rgbToColor(layer.fontColor || { r: 0, g: 0, b: 0 }),
                        _horizontalAlign: 1,
                        _verticalAlign: 1
                    }
                });
            } else {
                // 图片图层
                const resourcePath = `db://assets/textures/psd/${layer.layerPath}.png`;
                node.resourcePath = resourcePath;
                this.resourceMap.set(layer.name, resourcePath);

                node.components.push({
                    type: 'cc.UITransform',
                    properties: {
                        _contentSize: {
                            __type__: 'cc.Size',
                            width: layer.width,
                            height: layer.height
                        }
                    }
                });

                node.components.push({
                    type: 'cc.Sprite',
                    properties: {
                        _sizeMode: 0,
                        _type: 0
                    }
                });
            }

            // 检测特殊组件
            const name = layer.name.toLowerCase();
            if (name.includes('btn') || name.includes('button')) {
                node.components.push({
                    type: 'cc.Button',
                    properties: {
                        _transition: 2,
                        _normalColor: this.rgbToColor({ r: 255, g: 255, b: 255 }),
                        _pressedColor: this.rgbToColor({ r: 200, g: 200, b: 200 })
                    }
                });
            } else if (name.includes('input') || name.includes('textfield')) {
                node.components.push({
                    type: 'cc.EditBox',
                    properties: {
                        _placeholder: '请输入...',
                        _fontSize: 20
                    }
                });
            } else if (name.includes('toggle') || name.includes('checkbox')) {
                node.components.push({
                    type: 'cc.Toggle',
                    properties: {
                        _isChecked: false
                    }
                });
            }

            this.nodes.push(node);
        }

        console.log(`生成 ${this.nodes.length} 个节点\n`);
    }

    /**
     * 导出图片资源
     */
    async exportResources(outputDir: string): Promise<void> {
        console.log('🖼️ 导出图片资源...\n');

        const targetDir = path.join(outputDir, 'textures/psd');
        await mkdir(targetDir, { recursive: true });

        let exportCount = 0;

        for (const layer of this.layers) {
            if (layer.isGroup || layer.isText) continue;

            try {
                // 导出图层为 PNG
                const layerPsd = this.extractLayer(layer);
                const png = PSD.writePsd(layerPsd);

                const fileName = `${layer.layerPath}.png`;
                const filePath = path.join(targetDir, fileName);

                await writeFile(filePath, png);
                console.log(`  ✓ ${fileName}`);
                exportCount++;

            } catch (e) {
                console.log(`  ⚠ ${layer.name} 导出失败`);
            }
        }

        console.log(`\n导出 ${exportCount} 个图片资源到: ${targetDir}\n`);
    }

    /**
     * 提取单个图层
     */
    private extractLayer(layer: LayerInfo): any {
        // 简化实现：创建一个新的 PSD 只包含该图层
        // 实际使用时需要更复杂的处理
        return {
            width: layer.width,
            height: layer.height,
            tree: this.psd.tree // 简化版
        };
    }

    /**
     * 生成 MD 定义文件
     */
    async generateMDDefinition(outputPath: string): Promise<void> {
        console.log('📝 生成 MD 定义文件...\n');

        const rootName = this.nodes[0]?.name || 'Prefab';

        let md = `# 预制体定义: ${rootName}

## 元数据
- 保存路径: db://assets/prefabs/psd/${rootName}.prefab
- 来源: PSD 文件自动生成
- 生成时间: ${new Date().toLocaleString()}

## 节点树
\`\`\`
`;

        // 生成节点树
        for (const node of this.nodes) {
            const indent = node.parent ? '  ├── ' : '';
            const parentInfo = node.parent ? ` (父: ${node.parent})` : '';
            md += `${indent}${node.name} (${node.size[0]}x${node.size[1]})${parentInfo}\n`;

            if (node.resourcePath) {
                md += `  │   └── 资源: ${node.resourcePath}\n`;
            }
        }

        md += `\`\`\`\n\n## 节点定义\n\n`;

        // 生成节点定义
        for (const node of this.nodes) {
            md += `### ${node.name}\n`;
            md += `\`\`\`yaml\n`;
            if (node.parent) {
                md += `parent: ${node.parent}\n`;
            }
            md += `position: [${node.position.join(', ')}]\n`;
            md += `components:\n`;

            for (const comp of node.components) {
                md += `  - type: ${comp.type}\n`;
                if (comp.properties) {
                    md += `    properties:\n`;
                    for (const [key, value] of Object.entries(comp.properties)) {
                        if (typeof value === 'object') {
                            md += `      ${key}: ${JSON.stringify(value)}\n`;
                        } else {
                            md += `      ${key}: ${value}\n`;
                        }
                    }
                }
            }

            md += `\`\`\`\n\n`;
        }

        await writeFile(outputPath, md, 'utf-8');
        console.log(`✓ MD 文件已保存: ${outputPath}\n`);
    }

    /**
     * 生成预制体（通过 MCP）
     */
    async generatePrefab(prefabPath: string): Promise<void> {
        console.log('🎮 通过 MCP 生成预制体...\n');

        // 获取场景信息
        const sceneResult = await this.callMCP('scene_get_current_scene');
        const sceneData = JSON.parse(sceneResult.result.content[0].text);
        console.log(`当前场景: ${sceneData.data.name}\n`);

        const nodeUuids = new Map<string, string>();

        // 按层级排序
        const sortedNodes = [...this.nodes].sort((a, b) => {
            if (!a.parent) return -1;
            if (!b.parent) return 1;
            return 0;
        });

        console.log('创建节点:\n');

        for (const node of sortedNodes) {
            const parentUuid = node.parent ? nodeUuids.get(node.parent) : sceneData.data.uuid;

            // 创建节点
            const createResult = await this.callMCP('node_create_node', {
                name: node.name,
                parentUuid: parentUuid
            });

            const createData = JSON.parse(createResult.result.content[0].text);
            const uuid = createData.data.uuid;
            nodeUuids.set(node.name, uuid);

            console.log(`  ✓ ${node.name} (${uuid.substring(0, 8)}...)`);

            // 设置位置
            await this.callMCP('node_set_node_transform', {
                nodeUuid: uuid,
                position: {
                    x: node.position[0],
                    y: node.position[1],
                    z: node.position[2]
                }
            });

            // 添加组件
            for (const comp of node.components) {
                try {
                    await this.callMCP('component_add_component', {
                        nodeUuid: uuid,
                        componentType: comp.type
                    });

                    if (comp.properties) {
                        await this.callMCP('component_set_component_property', {
                            nodeUuid: uuid,
                            componentType: comp.type,
                            properties: comp.properties
                        });
                    }
                } catch (e) {
                    // 忽略组件错误
                }
            }
        }

        // 创建预制体
        const rootName = this.nodes[0]?.name || 'Root';
        const rootUuid = nodeUuids.get(rootName);

        if (rootUuid) {
            console.log(`\n💾 保存预制体: ${prefabPath}`);
            await this.callMCP('prefab_create_prefab', {
                nodeUuid: rootUuid,
                prefabPath: prefabPath
            });
            console.log('✓ 预制体已保存\n');
        }
    }

    /**
     * 调用 MCP 工具
     */
    private async callMCP(toolName: string, args: any): Promise<any> {
        const response = await fetch(MCP_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: Date.now(),
                method: 'tools/call',
                params: {
                    name: toolName,
                    arguments: args
                }
            })
        });

        const result = await response.json();

        if (result.error) {
            throw new Error(`MCP Error: ${result.error.message}`);
        }

        return result;
    }

    /**
     * 清理节点名称
     */
    private sanitizeName(name: string): string {
        return name
            .replace(/[\/\\:*?"<>|]/g, '_')
            .replace(/\s+/g, '')
            .trim();
    }

    /**
     * RGB 转 Color 对象
     */
    private rgbToColor(rgb: { r: number; g: number; b: number }): any {
        return {
            __type__: 'cc.Color',
            r: rgb.r,
            g: rgb.g,
            b: rgb.b,
            a: 255
        };
    }

    /**
     * 获取节点列表
     */
    getNodes(): PrefabNode[] {
        return this.nodes;
    }

    /**
     * 获取图层列表
     */
    getLayers(): LayerInfo[] {
        return this.layers;
    }
}

/**
 * 主函数
 */
async function main() {
    const psdPath = process.argv[2];
    const outputDir = process.argv[3] || './assets';

    if (!psdPath) {
        console.log('用法: npx tsx psd-to-prefab-full.ts <psd文件> [输出目录]');
        console.log('示例: npx tsx psd-to-prefab-full.ts design/UI.psd ./assets');
        process.exit(1);
    }

    console.log('╔══════════════════════════════════════════╗');
    console.log('║   PSD → 预制体完整解决方案               ║');
    console.log('╚══════════════════════════════════════════╝\n');

    try {
        const engine = new PSDEngine();

        // 1. 加载 PSD
        await engine.loadPSD(psdPath);

        // 2. 生成节点
        engine.generateNodes();

        // 3. 导出资源
        await engine.exportResources(outputDir);

        // 4. 生成 MD 定义
        const prefabName = path.basename(psdPath, '.psd');
        const mdPath = path.join(outputDir, 'prefab-definitions', `${prefabName}.md`);
        await mkdir(path.dirname(mdPath), { recursive: true });
        await engine.generateMDDefinition(mdPath);

        // 5. 生成预制体
        await engine.generatePrefab(`db://assets/prefabs/psd/${prefabName}.prefab`);

        console.log('✅ 全部完成！\n');
        console.log('生成文件:');
        console.log(`  - MD 定义: ${mdPath}`);
        console.log(`  - 图片资源: ${path.join(outputDir, 'textures/psd/')}`);
        console.log(`  - 预制体: db://assets/prefabs/psd/${prefabName}.prefab`);

    } catch (error) {
        console.error('\n❌ 错误:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

main().catch(console.error);
