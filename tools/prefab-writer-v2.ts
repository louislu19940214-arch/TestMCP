/**
 * 预制体文件写入器 V2 - 修复版
 * 生成正确的 Cocos Creator 预制体格式
 */

import { promises as fs } from 'fs';
import path from 'path';

interface ComponentData {
    __type__: string;
    _name?: string;
    _objFlags: number;
    node: { __id__: number };
    [key: string]: any;
}

interface NodeData {
    __type__: string;
    _name: string;
    _objFlags: number;
    _parent: { __id__: number } | null;
    _children: Array<{ __id__: number }>;
    _components: Array<{ __id__: number }>;
    _lpos: { __type__: string; x: number; y: number; z: number };
    _lrot: { __type__: string; x: number; y: number; z: number; w: number };
    _lscale: { __type__: string; x: number; y: number; z: number };
    _layer: number;
    _euler: { __type__: string; x: number; y: number; z: number };
}

interface PrefabData {
    __type__: string;
    _name: string;
    _objFlags: number;
    _native: string;
    _content: any[];
}

class PrefabWriterV2 {
    private content: any[] = [];
    private nodeIndex: Map<string, number> = new Map();
    private componentIndex: number = 1000;

    /**
     * 添加节点到预制体
     */
    addNode(data: {
        name: string;
        parent?: string;
        position?: [number, number, number];
        components?: Array<{ type: string; properties?: any }>;
    }): number {
        const node: NodeData = {
            __type__: 'cc.Node',
            _name: data.name,
            _objFlags: 0,
            _parent: null,
            _children: [],
            _components: [],
            _lpos: {
                __type__: 'cc.Vec3',
                x: data.position?.[0] || 0,
                y: data.position?.[1] || 0,
                z: data.position?.[2] || 0
            },
            _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
            _lscale: { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 },
            _layer: 1073741824,
            _euler: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 }
        };

        // 设置父节点引用
        if (data.parent) {
            const parentIndex = this.nodeIndex.get(data.parent);
            if (parentIndex !== undefined) {
                node._parent = { __id__: parentIndex };
                // 将此节点添加到父节点的 children
                const parentNode = this.content[parentIndex] as NodeData;
                parentNode._children.push({ __id__: this.content.length });
            }
        }

        // 添加节点到内容数组
        const index = this.content.length;
        this.nodeIndex.set(data.name, index);
        this.content.push(node);

        // 添加组件
        if (data.components) {
            for (const comp of data.components) {
                this.addComponent(index, comp.type, comp.properties);
            }
        }

        return index;
    }

    /**
     * 添加组件到节点
     */
    addComponent(nodeIndex: number, type: string, properties?: any): number {
        const component: ComponentData = {
            __type__: type,
            _name: '',
            _objFlags: 0,
            node: { __id__: nodeIndex },
            ...properties
        };

        const compIndex = this.componentIndex++;
        this.content.push(component);

        // 将组件添加到节点
        const node = this.content[nodeIndex] as NodeData;
        node._components.push({ __id__: compIndex });

        return compIndex;
    }

    /**
     * 生成预制体 JSON
     */
    generate(): PrefabData {
        return {
            __type__: 'cc.Prefab',
            _name: '',
            _objFlags: 0,
            _native: '',
            _content: this.content
        };
    }

    /**
     * 保存预制体到文件
     */
    async save(filePath: string): Promise<void> {
        // 确保 .prefab 扩展名
        if (!filePath.endsWith('.prefab')) {
            filePath += '.prefab';
        }

        // 确保目录存在
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });

        // 生成并写入
        const prefab = this.generate();
        const content = JSON.stringify(prefab, null, 2);
        await fs.writeFile(filePath, content, 'utf-8');

        console.log(`✓ 预制体已保存: ${filePath}`);
    }
}

/**
 * 创建 ShopItem 预制体
 */
async function createShopItemPrefab(): Promise<void> {
    const writer = new PrefabWriterV2();

    console.log('创建节点结构...\n');

    // 创建根节点
    writer.addNode({
        name: 'ShopItem',
        position: [0, 0, 0],
        components: [
            {
                type: 'cc.UITransform',
                properties: {
                    _contentSize: { __type__: 'cc.Size', width: 200, height: 300 },
                    _anchorPoint: { __type__: 'cc.Vec2', x: 0.5, y: 0.5 }
                }
            }
        ]
    });

    // 创建背景
    writer.addNode({
        name: 'BgSprite',
        parent: 'ShopItem',
        position: [0, 0, 0],
        components: [
            {
                type: 'cc.UITransform',
                properties: {
                    _contentSize: { __type__: 'cc.Size', width: 200, height: 300 },
                    _anchorPoint: { __type__: 'cc.Vec2', x: 0.5, y: 0.5 }
                }
            },
            {
                type: 'cc.Sprite',
                properties: {
                    _sizeMode: 0, // custom
                    _type: 0 // simple
                }
            }
        ]
    });

    // 创建图标容器
    writer.addNode({
        name: 'IconNode',
        parent: 'ShopItem',
        position: [0, 50, 0],
        components: [
            {
                type: 'cc.UITransform',
                properties: {
                    _contentSize: { __type__: 'cc.Size', width: 120, height: 120 },
                    _anchorPoint: { __type__: 'cc.Vec2', x: 0.5, y: 0.5 }
                }
            }
        ]
    });

    // 创建图标精灵
    writer.addNode({
        name: 'IconSprite',
        parent: 'IconNode',
        position: [0, 0, 0],
        components: [
            {
                type: 'cc.UITransform',
                properties: {
                    _contentSize: { __type__: 'cc.Size', width: 100, height: 100 },
                    _anchorPoint: { __type__: 'cc.Vec2', x: 0.5, y: 0.5 }
                }
            },
            {
                type: 'cc.Sprite',
                properties: {
                    _sizeMode: 2, // custom
                    _type: 0 // simple
                }
            }
        ]
    });

    // 创建名称标签
    writer.addNode({
        name: 'NameLabel',
        parent: 'ShopItem',
        position: [0, -30, 0],
        components: [
            {
                type: 'cc.UITransform',
                properties: {
                    _contentSize: { __type__: 'cc.Size', width: 180, height: 30 },
                    _anchorPoint: { __type__: 'cc.Vec2', x: 0.5, y: 0.5 }
                }
            },
            {
                type: 'cc.Label',
                properties: {
                    _string: '商品名称',
                    _fontSize: 24,
                    _color: { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 },
                    _overflow: 2,
                    _horizontalAlign: 1,
                    _verticalAlign: 1
                }
            }
        ]
    });

    // 创建价格标签
    writer.addNode({
        name: 'PriceLabel',
        parent: 'ShopItem',
        position: [0, -70, 0],
        components: [
            {
                type: 'cc.UITransform',
                properties: {
                    _contentSize: { __type__: 'cc.Size', width: 100, height: 25 },
                    _anchorPoint: { __type__: 'cc.Vec2', x: 0.5, y: 0.5 }
                }
            },
            {
                type: 'cc.Label',
                properties: {
                    _string: '¥99',
                    _fontSize: 20,
                    _color: { __type__: 'cc.Color', r: 255, g: 215, b: 0, a: 255 },
                    _horizontalAlign: 1,
                    _verticalAlign: 1
                }
            }
        ]
    });

    // 创建购买按钮
    writer.addNode({
        name: 'BuyButton',
        parent: 'ShopItem',
        position: [0, -120, 0],
        components: [
            {
                type: 'cc.UITransform',
                properties: {
                    _contentSize: { __type__: 'cc.Size', width: 140, height: 50 },
                    _anchorPoint: { __type__: 'cc.Vec2', x: 0.5, y: 0.5 }
                }
            },
            {
                type: 'cc.Button',
                properties: {
                    _normalColor: { __type__: 'cc.Color', r: 74, g: 144, b: 226, a: 255 },
                    _pressedColor: { __type__: 'cc.Color', r: 53, g: 122, b: 189, a: 255 },
                    _hoverColor: { __type__: 'cc.Color', r: 91, g: 160, b: 242, a: 255 },
                    _disabledColor: { __type__: 'cc.Color', r: 200, g: 200, b: 200, a: 255 },
                    _transition: 2, // color
                    _zoomScale: 1.2
                }
            }
        ]
    });

    // 创建按钮背景
    writer.addNode({
        name: 'BuyButtonBg',
        parent: 'BuyButton',
        position: [0, 0, 0],
        components: [
            {
                type: 'cc.UITransform',
                properties: {
                    _contentSize: { __type__: 'cc.Size', width: 140, height: 50 },
                    _anchorPoint: { __type__: 'cc.Vec2', x: 0.5, y: 0.5 }
                }
            },
            {
                type: 'cc.Sprite',
                properties: {
                    _type: 0, // simple
                    _color: { __type__: 'cc.Color', r: 74, g: 144, b: 226, a: 255 }
                }
            }
        ]
    });

    // 创建按钮标签
    writer.addNode({
        name: 'BuyButtonLabel',
        parent: 'BuyButton',
        position: [0, 0, 0],
        components: [
            {
                type: 'cc.UITransform',
                properties: {
                    _contentSize: { __type__: 'cc.Size', width: 100, height: 30 },
                    _anchorPoint: { __type__: 'cc.Vec2', x: 0.5, y: 0.5 }
                }
            },
            {
                type: 'cc.Label',
                properties: {
                    _string: '购买',
                    _fontSize: 18,
                    _color: { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 },
                    _horizontalAlign: 1,
                    _verticalAlign: 1
                }
            }
        ]
    });

    // 保存预制体
    const prefabPath = path.join(process.cwd(), '../assets/prefabs/shop/ShopItem.prefab');
    await writer.save(prefabPath);
}

// 主函数
async function main() {
    console.log('🔨 开始生成 ShopItem.prefab...\n');

    try {
        await createShopItemPrefab();
        console.log('\n✅ 预制体生成完成!');
    } catch (error) {
        console.error('❌ 生成失败:', error);
        process.exit(1);
    }
}

main().catch(console.error);
