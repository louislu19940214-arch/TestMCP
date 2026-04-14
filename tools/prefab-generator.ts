/**
 * 预制体生成器 - 从 MD 定义生成 Cocos Creator 预制体
 * 通过 MCP 服务器工具调用实现
 */

interface ComponentDef {
    type: string;
    properties?: Record<string, any>;
    clickEvents?: Array<{
        component?: string;
        handler?: string;
    }>;
}

interface NodeDef {
    name: string;
    parent?: string;
    nodeType?: string;
    size?: [number, number];
    position?: [number, number, number];
    components?: ComponentDef[];
    children?: NodeDef[];
}

interface PrefabMetadata {
    name: string;
    savePath: string;
    description?: string;
}

interface ParsedPrefab {
    metadata: PrefabMetadata;
    nodes: NodeDef[];
}

/**
 * MD 解析器 - 解析预制体定义文件
 */
class PrefabMDParser {
    /**
     * 从文件内容解析预制体定义
     */
    static parse(content: string): ParsedPrefab {
        const lines = content.split('\n');
        const result: ParsedPrefab = {
            metadata: { name: '', savePath: '' },
            nodes: []
        };

        let currentSection = '';
        let currentNode: NodeDef | null = null;
        let yamlContent = '';

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            // 检测预制体名称
            const nameMatch = line.match(/^#\s+预制体定义:\s*(.+)$/);
            if (nameMatch) {
                result.metadata.name = nameMatch[1].trim();
                continue;
            }

            // 检测元数据部分
            if (line.startsWith('## 元数据') || line.startsWith('## Metadata')) {
                currentSection = 'metadata';
                continue;
            }

            // 检测节点定义部分
            if (line.startsWith('## 节点定义')) {
                currentSection = 'nodes';
                continue;
            }

            // 解析元数据
            if (currentSection === 'metadata') {
                const pathMatch = line.match(/-\s+保存路径:\s*(.+)$/);
                if (pathMatch) {
                    result.metadata.savePath = pathMatch[1].trim();
                }
                const descMatch = line.match(/-\s+描述:\s*(.+)$/);
                if (descMatch) {
                    result.metadata.description = descMatch[1].trim();
                }
                continue;
            }

            // 解析节点定义
            if (currentSection === 'nodes') {
                // 检测节点头 ### NodeName
                const nodeMatch = line.match(/^###\s+(.+)$/);
                if (nodeMatch) {
                    // 保存上一个节点
                    if (currentNode) {
                        result.nodes.push(currentNode);
                    }
                    currentNode = {
                        name: nodeMatch[1].trim(),
                        components: []
                    };
                    yamlContent = '';
                    continue;
                }

                // 收集 YAML 内容
                if (currentNode && (line.startsWith('```yaml') || line.startsWith('```'))) {
                    if (yamlContent && !line.startsWith('```yaml')) {
                        // 结束 YAML 块，解析内容
                        this.parseNodeYaml(currentNode, yamlContent);
                        yamlContent = '';
                    }
                    continue;
                }

                if (currentNode && currentSection === 'nodes' && !line.startsWith('#')) {
                    yamlContent += line + '\n';
                }
            }
        }

        // 保存最后一个节点
        if (currentNode) {
            result.nodes.push(currentNode);
        }

        return result;
    }

    /**
     * 解析节点的 YAML 内容
     */
    private static parseNodeYaml(node: NodeDef, yaml: string): void {
        const lines = yaml.trim().split('\n');

        for (const line of lines) {
            const trimmed = line.trim();

            // 解析 key: value 格式
            const match = trimmed.match(/^(\w+):\s*(.+)$/);
            if (match) {
                const [, key, value] = match;

                switch (key) {
                    case 'parent':
                        node.parent = value;
                        break;
                    case 'nodeType':
                        node.nodeType = value;
                        break;
                    case 'size':
                    case 'position':
                        node[key] = this.parseArray(value);
                        break;
                }
            }

            // 解析组件 - type: XXX
            if (trimmed.startsWith('- type:')) {
                const compType = trimmed.substring(7).trim();
                const component: ComponentDef = { type: compType, properties: {} };

                // 继续读取组件属性
                const propMatch = trimmed.match(/properties:\s*\[(.+)\]/);
                if (propMatch) {
                    // 单行属性
                }

                if (!node.components) {
                    node.components = [];
                }
                node.components.push(component);
            }

            // 解析组件属性
            if (trimmed.includes('properties:') && !trimmed.startsWith('- type:')) {
                // 属性块开始
            }
        }
    }

    /**
     * 解析数组 [a, b, c]
     */
    private static parseArray(str: string): any {
        const match = str.match(/\[(.+)\]/);
        if (match) {
            const values = match[1].split(',').map(v => v.trim());
            // 检测数字数组
            if (values.every(v => !isNaN(Number(v)))) {
                return values.map(v => Number(v));
            }
            return values;
        }
        return str;
    }
}

/**
 * 预制体构建器 - 生成 MCP 工具调用序列
 */
class PrefabBuilder {
    private parsed: ParsedPrefab;
    private nodeUuids: Map<string, string> = new Map();

    constructor(parsed: ParsedPrefab) {
        this.parsed = parsed;
    }

    /**
     * 生成完整的 MCP 工具调用序列
     */
    generateToolCalls(): any[] {
        const calls: any[] = [];

        // 1. 创建场景根节点（临时）
        calls.push({
            tool: 'node_lifecycle',
            arguments: {
                action: 'create',
                name: '__PrefabBuilder__',
                nodeType: '2DNode'
            }
        });

        // 2. 按层级顺序创建所有节点
        const sortedNodes = this.sortNodesByHierarchy(this.parsed.nodes);
        for (const node of sortedNodes) {
            calls.push(...this.generateNodeCreateCalls(node));
        }

        // 3. 从根节点创建预制体
        calls.push({
            tool: 'prefab_lifecycle',
            arguments: {
                action: 'createFromNode',
                nodeUuid: this.nodeUuids.get(this.parsed.metadata.name) || '',
                prefabPath: this.parsed.metadata.savePath
            }
        });

        return calls;
    }

    /**
     * 生成单个节点的创建和配置调用
     */
    private generateNodeCreateCalls(node: NodeDef): any[] {
        const calls: any[] = [];
        const nodeName = node.name;

        // 1. 创建节点
        const parentUuid = node.parent
            ? (this.nodeUuids.get(node.parent) || '')
            : '';

        calls.push({
            tool: 'node_lifecycle',
            arguments: {
                action: 'create',
                name: nodeName,
                parentUuid: parentUuid,
                nodeType: node.nodeType || '2DNode'
            }
        });

        // 保存 UUID 映射（实际使用时需要从返回结果获取）
        this.nodeUuids.set(nodeName, `__UUID_${nodeName}__`);

        // 2. 设置变换属性
        if (node.size || node.position) {
            const transform: any = {};

            if (node.position) {
                transform.position = {
                    x: node.position[0],
                    y: node.position[1],
                    z: node.position[2]
                };
            }

            if (node.size) {
                transform.contentSize = {
                    width: node.size[0],
                    height: node.size[1]
                };
            }

            calls.push({
                tool: 'node_transform',
                arguments: {
                    action: 'setPosition',
                    nodeName: nodeName,
                    ...transform
                }
            });
        }

        // 3. 添加组件
        if (node.components) {
            for (const comp of node.components) {
                calls.push({
                    tool: 'component_manage',
                    arguments: {
                        action: 'add',
                        nodeName: nodeName,
                        componentType: comp.type
                    }
                });

                // 4. 设置组件属性
                if (comp.properties && Object.keys(comp.properties).length > 0) {
                    calls.push({
                        tool: 'set_component_property',
                        arguments: {
                            nodeName: nodeName,
                            componentType: comp.type,
                            properties: comp.properties
                        }
                    });
                }
            }
        }

        return calls;
    }

    /**
     * 按层级顺序排序节点（父节点优先）
     */
    private sortNodesByHierarchy(nodes: NodeDef[]): NodeDef[] {
        const sorted: NodeDef[] = [];
        const visited = new Set<string>();

        const visit = (nodeName: string) => {
            if (visited.has(nodeName)) return;

            const node = nodes.find(n => n.name === nodeName);
            if (!node) return;

            // 先访问父节点
            if (node.parent) {
                visit(node.parent);
            }

            visited.add(nodeName);
            sorted.push(node);
        };

        for (const node of nodes) {
            visit(node.name);
        }

        return sorted;
    }

    /**
     * 获取可执行的 JSON 格式
     */
    toJSON(): string {
        return JSON.stringify(this.generateToolCalls(), null, 2);
    }
}

/**
 * 主函数 - 从文件生成预制体
 */
export async function generatePrefabFromMD(mdContent: string): Promise<any[]> {
    // 1. 解析 MD
    const parsed = PrefabMDParser.parse(mdContent);

    console.log('解析结果:', JSON.stringify(parsed, null, 2));

    // 2. 构建工具调用序列
    const builder = new PrefabBuilder(parsed);
    const calls = builder.generateToolCalls();

    console.log('生成的 MCP 调用:', builder.toJSON());

    return calls;
}

/**
 * CLI 入口
 */
export async function main() {
    const fs = await import('fs/promises');
    const path = await import('path');

    const mdPath = path.join(process.cwd(), 'assets/prefab-definitions/ShopItem.md');
    const content = await fs.readFile(mdPath, 'utf-8');

    const calls = await generatePrefabFromMD(content);

    console.log('\n========== MCP 工具调用序列 ==========\n');
    console.log(JSON.stringify(calls, null, 2));
    console.log('\n=====================================\n');

    // 保存到文件
    const outputPath = path.join(process.cwd(), 'tools/prefab-calls.json');
    await fs.writeFile(outputPath, JSON.stringify(calls, null, 2));
    console.log(`已保存到: ${outputPath}`);
}

// 如果直接运行此文件
if (require.main === module) {
    main().catch(console.error);
}
