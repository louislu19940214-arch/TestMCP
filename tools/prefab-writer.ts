/**
 * 预制体文件写入器
 * 生成符合 Cocos Creator 格式的 .prefab 文件
 */

import { promises as fs } from 'fs';
import path from 'path';

interface ComponentData {
    __type__: string;
    [key: string]: any;
}

interface NodeData {
    __type__: string;
    _name: string;
    _objFlags: number;
    _parent: { __id__: number } | null;
    _children: { __id__: number }[];
    _components: { __id__: number }[];
    _lpos: { __type__: string; x: number; y: number; z: number };
    _lrot: { __type__: string; x: number; y: number; z: number; w: number };
    _lscale: { __type__: string; x: number; y: number; z: number };
    _layer: number;
    _euler: { __type__: string; x: number; y: number; z: number };
    [key: string]: any;
}

interface PrefabData {
    __type__: string;
    _name: string;
    _objFlags: number;
    _native: string;
    _content: NodeData[];
}

class PrefabWriter {
    private nodes: NodeData[] = [];
    private components: ComponentData[] = [];
    private nodeIndex: Map<string, number> = new Map();

    /**
     * 添加节点到预制体
     */
    addNode(data: {
        name: string;
        parent?: string;
        children?: string[];
        components?: Array<{ type: string; properties?: any }>;
        position?: [number, number, number];
        size?: [number, number];
    }): number {
        const node: NodeData = {
            __type__: 'cc.Node',
            _name: data.name,
            _objFlags: 0,
            _parent: null,
            _children: [],
            _components: [],
            _lpos: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
            _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
            _lscale: { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 },
            _layer: 1073741824,
            _euler: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
        };

        // 设置位置
        if (data.position) {
            node._lpos = {
                __type__: 'cc.Vec3',
                x: data.position[0],
                y: data.position[1],
                z: data.position[2]
            };
        }

        // 添加到索引
        const index = this.nodes.length;
        this.nodeIndex.set(data.name, index);
        this.nodes.push(node);

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

        const compIndex = 1000 + this.components.length;
        this.components.push(component);

        // 将组件添加到节点
        this.nodes[nodeIndex]._components.push({ __id__: compIndex });

        return compIndex;
    }

    /**
     * 建立父子关系
     */
    setParent(childName: string, parentName: string): void {
        const childIndex = this.nodeIndex.get(childName);
        const parentIndex = this.nodeIndex.get(parentName);

        if (childIndex !== undefined && parentIndex !== undefined) {
            this.nodes[childIndex]._parent = { __id__: parentIndex };
            this.nodes[parentIndex]._children.push({ __id__: childIndex });
        }
    }

    /**
     * 生成预制体 JSON
     */
    generate(): string {
        // 合并节点和组件
        const content: any[] = [];

        // 添加根节点标记
        content.push({
            __type__: 'cc.SceneAsset',
            _name: '',
            _objFlags: 0,
            _native: '',
            scene: { __id__: 1 }
        });

        // 添加所有节点
        for (const node of this.nodes) {
            content.push(node);
        }

        // 添加所有组件
        for (const comp of this.components) {
            content.push(comp);
        }

        const prefab: PrefabData = {
            __type__: 'cc.Prefab',
            _name: '',
            _objFlags: 0,
            _native: '',
            _content: content
        };

        return JSON.stringify(prefab, null, 2);
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
        const content = this.generate();
        await fs.writeFile(filePath, content, 'utf-8');

        console.log(`✓ 预制体已保存: ${filePath}`);
    }
}

/**
 * 创建 ShopItem 预制体
 */
async function createShopItemPrefab(): Promise<void> {
    const writer = new PrefabWriter();

    // 创建根节点
    writer.addNode({
        name: 'ShopItem',
        position: [0, 0, 0],
        components: [
            { type: 'cc.UITransform', properties: { _contentSize: { __type__: 'cc.Size', width: 200, height: 300 } } }
        ]
    });

    // 创建背景
    writer.addNode({
        name: 'BgSprite',
        position: [0, 0, 0],
        components: [
            { type: 'cc.UITransform', properties: { _contentSize: { __type__: 'cc.Size', width: 200, height: 300 } } },
            { type: 'cc.Sprite', properties: { _spriteFrame: { __uuid__: 'bg-texture-uuid' }, _type: 1 } }
        ]
    });
    writer.setParent('BgSprite', 'ShopItem');

    // 创建图标节点
    writer.addNode({
        name: 'IconNode',
        position: [0, 50, 0],
        components: [
            { type: 'cc.UITransform', properties: { _contentSize: { __type__: 'cc.Size', width: 120, height: 120 } } }
        ]
    });
    writer.setParent('IconNode', 'ShopItem');

    // 创建图标精灵
    writer.addNode({
        name: 'IconSprite',
        position: [0, 0, 0],
        components: [
            { type: 'cc.UITransform', properties: { _contentSize: { __type__: 'cc.Size', width: 100, height: 100 } } },
            { type: 'cc.Sprite', properties: { _spriteFrame: { __uuid__: 'icon-texture-uuid' }, _sizeMode: 2 } }
        ]
    });
    writer.setParent('IconSprite', 'IconNode');

    // 创建名称标签
    writer.addNode({
        name: 'NameLabel',
        position: [0, -30, 0],
        components: [
            { type: 'cc.UITransform', properties: { _contentSize: { __type__: 'cc.Size', width: 180, height: 30 } } },
            { type: 'cc.Label', properties: { _string: '商品名称', _fontSize: 24, _color: { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 }, _overflow: 2 } }
        ]
    });
    writer.setParent('NameLabel', 'ShopItem');

    // 创建价格标签
    writer.addNode({
        name: 'PriceLabel',
        position: [0, -70, 0],
        components: [
            { type: 'cc.UITransform', properties: { _contentSize: { __type__: 'cc.Size', width: 100, height: 25 } } },
            { type: 'cc.Label', properties: { _string: '¥99', _fontSize: 20, _color: { __type__: 'cc.Color', r: 255, g: 215, b: 0, a: 255 } } }
        ]
    });
    writer.setParent('PriceLabel', 'ShopItem');

    // 创建购买按钮
    writer.addNode({
        name: 'BuyButton',
        position: [0, -120, 0],
        components: [
            { type: 'cc.UITransform', properties: { _contentSize: { __type__: 'cc.Size', width: 140, height: 50 } } },
            { type: 'cc.Button', properties: { _normalColor: { __type__: 'cc.Color', r: 74, g: 144, b: 226, a: 255 }, _pressedColor: { __type__: 'cc.Color', r: 53, g: 122, b: 189, a: 255 }, _hoverColor: { __type__: 'cc.Color', r: 91, g: 160, b: 242, a: 255 }, _transition: 1 } }
        ]
    });
    writer.setParent('BuyButton', 'ShopItem');

    // 创建按钮背景
    writer.addNode({
        name: 'BuyButtonBg',
        position: [0, 0, 0],
        components: [
            { type: 'cc.UITransform', properties: { _contentSize: { __type__: 'cc.Size', width: 140, height: 50 } } },
            { type: 'cc.Sprite', properties: { _type: 1, _color: { __type__: 'cc.Color', r: 74, g: 144, b: 226, a: 255 } } }
        ]
    });
    writer.setParent('BuyButtonBg', 'BuyButton');

    // 创建按钮标签
    writer.addNode({
        name: 'BuyButtonLabel',
        position: [0, 0, 0],
        components: [
            { type: 'cc.UITransform', properties: { _contentSize: { __type__: 'cc.Size', width: 100, height: 30 } } },
            { type: 'cc.Label', properties: { _string: '购买', _fontSize: 18, _color: { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 } } }
        ]
    });
    writer.setParent('BuyButtonLabel', 'BuyButton');

    // 保存预制体
    const prefabPath = path.join(process.cwd(), 'assets/prefabs/shop/ShopItem.prefab');
    await writer.save(prefabPath);

    console.log('\n生成的预制体结构:');
    console.log(JSON.stringify(writer.generate(), null, 2));
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
