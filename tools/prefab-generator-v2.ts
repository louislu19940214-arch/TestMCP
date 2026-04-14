/**
 * 预制体生成器 V2 - 改进版
 * 直接通过 MCP HTTP 接口调用 Cocos Creator
 */

import path from 'path';
import { fileURLToPath } from 'url';

const MCP_BASE_URL = process.env.COCOS_MCP_URL ?? 'http://127.0.0.1:8585/mcp';

interface NodeCreateOptions {
    name: string;
    parent?: string;
    nodeType?: string;
    position?: [number, number, number];
    size?: [number, number];
    components?: ComponentConfig[];
}

interface ComponentConfig {
    type: string;
    properties?: Record<string, any>;
}

/**
 * 简化的预制体生成器
 */
class SimplePrefabGenerator {
    private baseUrl: string;
    private nodeUuidMap: Map<string, string> = new Map();

    constructor(baseUrl: string = MCP_BASE_URL) {
        this.baseUrl = baseUrl;
    }

    /**
     * 调用 MCP 工具
     */
    private async callTool(toolName: string, args: any): Promise<any> {
        const response = await fetch(this.baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
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
        return result;
    }

    /**
     * 创建节点
     */
    async createNode(options: NodeCreateOptions): Promise<string> {
        const args: any = {
            action: 'create',
            name: options.name,
            nodeType: options.nodeType || '2DNode'
        };

        if (options.parent) {
            const parentUuid = this.nodeUuidMap.get(options.parent);
            if (parentUuid) {
                args.parentUuid = parentUuid;
            }
        }

        const result = await this.callTool('node_lifecycle', args);
        const uuid = result?.result?.content?.[0]?.text;

        if (uuid) {
            this.nodeUuidMap.set(options.name, uuid);
            console.log(`✓ 创建节点: ${options.name} (UUID: ${uuid})`);
        }

        return uuid;
    }

    /**
     * 设置节点变换
     */
    async setTransform(name: string, position?: [number, number, number], size?: [number, number]): Promise<void> {
        const args: any = {
            action: 'setPosition',
            nodeName: name
        };

        if (position) {
            args.position = { x: position[0], y: position[1], z: position[2] };
        }

        if (size) {
            args.contentSize = { width: size[0], height: size[1] };
        }

        await this.callTool('node_transform', args);
        console.log(`  ✓ 设置变换: ${name}`);
    }

    /**
     * 添加组件
     */
    async addComponent(nodeName: string, component: ComponentConfig): Promise<void> {
        await this.callTool('component_manage', {
            action: 'add',
            nodeName: nodeName,
            componentType: component.type
        });

        if (component.properties) {
            await this.callTool('set_component_property', {
                nodeName: nodeName,
                componentType: component.type,
                properties: component.properties
            });
        }

        console.log(`  ✓ 添加组件: ${component.type}`);
    }

    /**
     * 创建预制体
     */
    async createPrefab(nodeName: string, prefabPath: string): Promise<void> {
        const uuid = this.nodeUuidMap.get(nodeName);
        if (!uuid) {
            throw new Error(`节点 ${nodeName} 不存在`);
        }

        await this.callTool('prefab_lifecycle', {
            action: 'createFromNode',
            nodeUuid: uuid,
            prefabPath: prefabPath
        });

        console.log(`✓ 预制体已创建: ${prefabPath}`);
    }

    /**
     * 从定义构建完整预制体
     */
    async buildFromDefinition(definition: {
        name: string;
        savePath: string;
        nodes: NodeCreateOptions[];
    }): Promise<void> {
        console.log(`\n开始构建预制体: ${definition.name}`);
        console.log('='.repeat(50));

        // 按层级顺序创建节点
        const sorted = this.sortByParent(definition.nodes);

        for (const nodeDef of sorted) {
            await this.createNode(nodeDef);

            if (nodeDef.position || nodeDef.size) {
                await this.setTransform(nodeDef.name, nodeDef.position, nodeDef.size);
            }

            if (nodeDef.components) {
                for (const comp of nodeDef.components) {
                    await this.addComponent(nodeDef.name, comp);
                }
            }
        }

        // 保存为预制体
        await this.createPrefab(definition.name, definition.savePath);

        console.log('='.repeat(50));
        console.log('✓ 预制体构建完成!\n');
    }

    /**
     * 按父节点排序
     */
    private sortByParent(nodes: NodeCreateOptions[]): NodeCreateOptions[] {
        const sorted: NodeCreateOptions[] = [];
        const visited = new Set<string>();

        const visit = (node: NodeCreateOptions) => {
            if (visited.has(node.name)) return;

            if (node.parent) {
                const parent = nodes.find(n => n.name === node.parent);
                if (parent) {
                    visit(parent);
                }
            }

            visited.add(node.name);
            sorted.push(node);
        };

        for (const node of nodes) {
            visit(node);
        }

        return sorted;
    }
}

/**
 * 预制体定义示例
 */
const shopItemDefinition = {
    name: 'ShopItem',
    savePath: 'db://assets/prefabs/shop/ShopItem.prefab',
    nodes: [
        {
            name: 'ShopItem',
            nodeType: '2DNode',
            size: [200, 300],
            position: [0, 0, 0],
            components: [
                {
                    type: 'UITransform',
                    properties: {
                        contentSize: { width: 200, height: 300 }
                    }
                }
            ]
        },
        {
            name: 'BgSprite',
            parent: 'ShopItem',
            nodeType: '2DNode',
            size: [200, 300],
            position: [0, 0, 0],
            components: [
                {
                    type: 'Sprite',
                    properties: {
                        spriteFrame: 'db://assets/textures/shop/item-bg.png',
                        type: 1 // sliced
                    }
                }
            ]
        },
        {
            name: 'IconNode',
            parent: 'ShopItem',
            nodeType: '2DNode',
            size: [120, 120],
            position: [0, 50, 0],
            components: [
                {
                    type: 'UITransform',
                    properties: {
                        contentSize: { width: 120, height: 120 }
                    }
                }
            ]
        },
        {
            name: 'IconSprite',
            parent: 'IconNode',
            nodeType: '2DNode',
            size: [100, 100],
            position: [0, 0, 0],
            components: [
                {
                    type: 'Sprite',
                    properties: {
                        spriteFrame: 'db://assets/textures/shop/icon-001.png',
                        sizeMode: 2 // custom
                    }
                }
            ]
        },
        {
            name: 'NameLabel',
            parent: 'ShopItem',
            nodeType: '2DNode',
            size: [180, 30],
            position: [0, -30, 0],
            components: [
                {
                    type: 'Label',
                    properties: {
                        string: '商品名称',
                        fontSize: 24,
                        color: '#FFFFFF',
                        overflow: 2 // clamp
                    }
                }
            ]
        },
        {
            name: 'PriceLabel',
            parent: 'ShopItem',
            nodeType: '2DNode',
            size: [100, 25],
            position: [0, -70, 0],
            components: [
                {
                    type: 'Label',
                    properties: {
                        string: '¥99',
                        fontSize: 20,
                        color: '#FFD700'
                    }
                }
            ]
        },
        {
            name: 'BuyButton',
            parent: 'ShopItem',
            nodeType: '2DNode',
            size: [140, 50],
            position: [0, -120, 0],
            components: [
                {
                    type: 'Button',
                    properties: {
                        normalColor: { r: 74, g: 144, b: 226, a: 255 },
                        pressedColor: { r: 53, g: 122, b: 189, a: 255 },
                        hoverColor: { r: 91, g: 160, b: 242, a: 255 },
                        transition: 1 // color
                    }
                }
            ]
        },
        {
            name: 'BuyButtonBg',
            parent: 'BuyButton',
            nodeType: '2DNode',
            size: [140, 50],
            position: [0, 0, 0],
            components: [
                {
                    type: 'Sprite',
                    properties: {
                        type: 1, // sliced
                        color: { r: 74, g: 144, b: 226, a: 255 }
                    }
                }
            ]
        },
        {
            name: 'BuyButtonLabel',
            parent: 'BuyButton',
            nodeType: '2DNode',
            size: [100, 30],
            position: [0, 0, 0],
            components: [
                {
                    type: 'Label',
                    properties: {
                        string: '购买',
                        fontSize: 18,
                        color: '#FFFFFF'
                    }
                }
            ]
        }
    ] as NodeCreateOptions[]
};

/**
 * 执行生成
 */
export async function generateShopItem() {
    const generator = new SimplePrefabGenerator();

    try {
        await generator.buildFromDefinition(shopItemDefinition);
    } catch (error) {
        console.error('生成预制体失败:', error);
    }
}

// 导出定义用于测试
export { shopItemDefinition, SimplePrefabGenerator };

async function main() {
    const generator = new SimplePrefabGenerator();

    try {
        await generator.buildFromDefinition(shopItemDefinition);
    } catch (error) {
        console.error('生成预制体失败:', error);
        process.exit(1);
    }
}

const isDirectRun =
    process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isDirectRun) {
    main().catch(console.error);
}
