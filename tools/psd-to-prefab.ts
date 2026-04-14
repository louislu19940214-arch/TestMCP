/**
 * PSD → 预制体转换器
 * 从 Photoshop PSD 文件生成 Cocos Creator 预制体
 */

import PSD from 'ag-psd';
import { promises as fs } from 'fs';
import path from 'path';

const MCP_URL = 'http://localhost:8585/mcp';

interface PSDLayer {
    name: string;
    left: number;
    top: number;
    width: number;
    height: number;
    visible: boolean;
    opacity: number;
    children?: PSDLayer[];
    text?: any;
}

interface NodeDef {
    name: string;
    parent?: string;
    position: [number, number, number];
    size: [number, number];
    visible: boolean;
    opacity: number;
    components: Array<{
        type: string;
        properties?: Record<string, any>;
    }>;
}

/**
 * 调用 MCP 工具
 */
async function callMCP(toolName: string, args: any = {}): Promise<any> {
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
 * 解析 PSD 文件
 */
async function parsePSD(psdPath: string): Promise<NodeDef[]> {
    console.log('📂 解析 PSD 文件...\n');

    const buffer = await fs.readFile(psdPath);
    const psd = PSD.readPsd(buffer, { skipLayerImageData: true });

    console.log(`PSD 信息:`);
    console.log(`  尺寸: ${psd.width} x ${psd.height}`);
    console.log(`  图层数: ${countLayers(psd.tree)}`);

    const nodes: NodeDef[] = [];
    const psdRoot = psd.width / 2; // 中心点

    // 解析图层树
    parseLayerTree(psd.tree, nodes, null, psdRoot, psd.height / 2);

    return nodes;
}

/**
 * 递归解析图层树
 */
function parseLayerTree(
    layer: any,
    nodes: NodeDef[],
    parentName: string | null,
    rootX: number,
    rootY: number
): void {
    if (!layer) return;

    // 如果是图层（不是图层组）
    if (layer.layerType !== 'group') {
        const node: NodeDef = {
            name: layer.name || 'Unnamed',
            parent: parentName || undefined,
            position: [
                Math.round(layer.left - rootX),
                Math.round(rootY - layer.top), // Y 轴翻转
                0
            ],
            size: [layer.width, layer.height],
            visible: layer.visible !== false,
            opacity: layer.opacity || 255,
            components: []
        };

        // 检测图层类型并添加组件
        if (layer.text) {
            // 文字图层
            node.components.push({
                type: 'cc.Label',
                properties: {
                    _string: layer.text.text || '',
                    _fontSize: layer.text.font?.size || 20,
                    _color: rgbToColor(layer.text.font?.colors || { r: 0, g: 0, b: 0 })
                }
            });
        } else {
            // 图片图层
            node.components.push({
                type: 'cc.Sprite',
                properties: {
                    _sizeMode: 0, // custom
                    _type: 0 // simple
                }
            });
        }

        // 检测特殊命名的图层（按钮、输入框等）
        const name = layer.name.toLowerCase();
        if (name.includes('btn') || name.includes('button')) {
            node.components.push({
                type: 'cc.Button',
                properties: {
                    _transition: 2 // color
                }
            });
        }

        nodes.push(node);
    }

    // 递归处理子图层
    if (layer.children && layer.children.length > 0) {
        for (const child of layer.children) {
            // 如果是图层组，创建容器节点
            if (child.layerType === 'group') {
                const groupNode: NodeDef = {
                    name: child.name || 'Group',
                    parent: parentName || undefined,
                    position: [0, 0, 0],
                    size: [child.width || 100, child.height || 100],
                    visible: child.visible !== false,
                    opacity: child.opacity || 255,
                    components: [
                        { type: 'cc.UITransform' }
                    ]
                };
                nodes.push(groupNode);

                // 递归处理子图层，以该组为父节点
                parseLayerTree(child, nodes, groupNode.name, rootX, rootY);
            } else {
                parseLayerTree(child, nodes, parentName, rootX, rootY);
            }
        }
    }
}

/**
 * 计算图层数量
 */
function countLayers(tree: any): number {
    if (!tree) return 0;
    let count = 0;
    if (tree.children) {
        for (const child of tree.children) {
            if (child.layerType === 'group') {
                count += 1 + countLayers(child);
            } else {
                count++;
            }
        }
    }
    return count;
}

/**
 * RGB 转 Color 对象
 */
function rgbToColor(rgb: { r: number; g: number; b: number; a?: number }): {
    __type__: string;
    r: number;
    g: number;
    b: number;
    a: number;
} {
    return {
        __type__: 'cc.Color',
        r: rgb.r,
        g: rgb.g,
        b: rgb.b,
        a: rgb.a || 255
    };
}

/**
 * 从 PSD 生成预制体
 */
async function generatePrefabFromPSD(psdPath: string, prefabPath: string) {
    console.log('╔══════════════════════════════════════════╗');
    console.log('║   PSD → 预制体转换器                      ║');
    console.log('╚══════════════════════════════════════════╝\n');

    // 解析 PSD
    const nodes = await parsePSD(psdPath);

    console.log(`\n✓ 解析完成，生成 ${nodes.length} 个节点\n`);

    // 显示节点结构
    console.log('📋 节点结构:');
    for (const node of nodes) {
        const indent = node.parent ? '  └─ ' : '';
        const parent = node.parent ? ` (父: ${node.parent})` : ' (根节点)';
        console.log(`  ${indent}${node.name}${parent}`);
        console.log(`      位置: (${node.position.join(', ')}) 尺寸: ${node.size.join('x')}`);
    }

    // 获取场景信息
    console.log('\n🔍 连接到 Cocos Creator...');
    const sceneResult = await callMCP('scene_get_current_scene');
    const sceneData = JSON.parse(sceneResult.result.content[0].text);
    console.log(`当前场景: ${sceneData.data.name}\n`);

    // 创建节点
    const nodeUuids = new Map<string, string>();

    // 按层级排序
    const sortedNodes = [...nodes].sort((a, b) => {
        if (!a.parent) return -1;
        if (!b.parent) return 1;
        return 0;
    });

    console.log('🔨 开始创建节点...\n');

    for (const node of sortedNodes) {
        const parentUuid = node.parent ? nodeUuids.get(node.parent) : sceneData.data.uuid;

        console.log(`创建: ${node.name}`);

        // 创建节点
        const createResult = await callMCP('node_create_node', {
            name: node.name,
            parentUuid: parentUuid
        });

        const createData = JSON.parse(createResult.result.content[0].text);
        const uuid = createData.data.uuid;
        nodeUuids.set(node.name, uuid);

        // 设置位置
        await callMCP('node_set_node_transform', {
            nodeUuid: uuid,
            position: {
                x: node.position[0],
                y: node.position[1],
                z: node.position[2]
            }
        });

        // 设置大小
        await callMCP('node_set_node_property', {
            nodeUuid: uuid,
            property: '_contentSize',
            value: {
                __type__: 'cc.Size',
                width: node.size[0],
                height: node.size[1]
            }
        });

        // 设置可见性和透明度
        if (!node.visible) {
            await callMCP('node_set_node_property', {
                nodeUuid: uuid,
                property: 'active',
                value: false
            });
        }

        // 添加组件
        for (const comp of node.components) {
            try {
                await callMCP('component_add_component', {
                    nodeUuid: uuid,
                    componentType: comp.type
                });

                if (comp.properties) {
                    await callMCP('component_set_component_property', {
                        nodeUuid: uuid,
                        componentType: comp.type,
                        properties: comp.properties
                    });
                }
            } catch (e) {
                console.log(`    ⚠ 组件 ${comp.type} 添加失败`);
            }
        }

        console.log(`  ✓ 完成`);
    }

    // 创建预制体
    const rootName = nodes[0]?.name || 'Root';
    const rootUuid = nodeUuids.get(rootName);

    if (rootUuid) {
        console.log(`\n💾 保存预制体: ${prefabPath}`);
        await callMCP('prefab_create_prefab', {
            nodeUuid: rootUuid,
            prefabPath: prefabPath
        });
        console.log('✓ 预制体已保存');
    }

    console.log('\n✅ 完成！');
}

// 主函数
async function main() {
    const psdPath = process.argv[2];
    const prefabPath = process.argv[3];

    if (!psdPath || !prefabPath) {
        console.log('用法: npx tsx psd-to-prefab.ts <psd文件> <prefab保存路径>');
        console.log('示例: npx tsx psd-to-prefab.ts design.psd db://assets/prefabs/UI.prefab');
        process.exit(1);
    }

    try {
        await generatePrefabFromPSD(psdPath, prefabPath);
    } catch (error) {
        console.error('\n❌ 错误:', error.message);
        process.exit(1);
    }
}

main().catch(console.error);
