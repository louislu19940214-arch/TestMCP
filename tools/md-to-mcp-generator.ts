/**
 * MD → MCP 预制体生成器
 * 从 Markdown 定义指挥真实的 cocos-mcp-server 生成预制体
 */

const MCP_URL = 'http://localhost:8585/mcp';

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

    // 返回完整 result，让调用者解析
    return result;
}

/**
 * 简单的 MD 解析器
 */
interface NodeDef {
    name: string;
    parent?: string;
    position?: [number, number, number];
    components: Array<{ type: string; props?: Record<string, any> }>;
}

function parseSimpleMD(content: string): { name: string; savePath: string; nodes: NodeDef[] } {
    const lines = content.split('\n');
    const result = {
        name: '',
        savePath: '',
        nodes: [] as NodeDef[]
    };

    let currentNode: NodeDef | null = null;
    let inYaml = false;

    for (const line of lines) {
        // 解析预制体名称
        const nameMatch = line.match(/预制体定义:\s*(.+)/);
        if (nameMatch) {
            result.name = nameMatch[1].trim();
            continue;
        }

        // 解析保存路径
        const pathMatch = line.match(/- 保存路径:\s*(.+)/);
        if (pathMatch) {
            result.savePath = pathMatch[1].trim();
            continue;
        }

        // 解析节点头 ### NodeName
        const nodeMatch = line.match(/^###\s+(.+)$/);
        if (nodeMatch) {
            if (currentNode) {
                result.nodes.push(currentNode);
            }
            currentNode = {
                name: nodeMatch[1].trim(),
                components: []
            };
            inYaml = false;
            continue;
        }

        // YAML 块开始
        if (line.includes('```yaml')) {
            inYaml = true;
            continue;
        }

        // YAML 块结束
        if (line === '```' && inYaml) {
            inYaml = false;
            if (currentNode) {
                result.nodes.push(currentNode);
                currentNode = null;
            }
            continue;
        }

        // 解析 YAML 内容
        if (inYaml && currentNode) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('//')) continue;

            // 解析 key: value
            const match = trimmed.match(/^(\w+):\s*(.+)$/);
            if (match) {
                const [, key, value] = match;

                switch (key) {
                    case 'parent':
                        currentNode.parent = value;
                        break;
                    case 'position':
                        currentNode.position = value.split(',').map(Number) as [number, number, number];
                        break;
                    case 'components':
                        // 开始组件列表
                        break;
                }
            }

            // 解析组件 - type: XXX
            if (trimmed.includes('- type:')) {
                const compType = trimmed.split(':')[1].trim();
                currentNode.components.push({ type: compType });
            }
        }
    }

    // 最后一个节点
    if (currentNode) {
        result.nodes.push(currentNode);
    }

    return result;
}

/**
 * 从 MD 生成预制体
 */
async function generatePrefabFromMD(mdPath: string) {
    // 读取 MD 文件
    const fs = await import('fs/promises');
    const content = await fs.readFile(mdPath, 'utf-8');

    console.log('📄 解析 MD 定义...\n');
    const definition = parseSimpleMD(content);

    console.log(`预制体名称: ${definition.name}`);
    console.log(`保存路径: ${definition.savePath}`);
    console.log(`节点数量: ${definition.nodes.length}\n`);

    // 获取当前场景
    console.log('🔍 获取当前场景...');
    const sceneResult = await callMCP('scene_get_current_scene');
    const sceneData = JSON.parse(sceneResult.result.content[0].text);
    console.log(`当前场景: ${sceneData.data.name}\n`);

    // 存储节点 UUID 映射
    const nodeUuids = new Map<string, string>();

    // 按层级排序节点（父节点优先）
    const sortedNodes = [...definition.nodes].sort((a, b) => {
        if (!a.parent) return -1;
        if (!b.parent) return 1;
        return 0;
    });

    console.log('🔨 开始创建节点...\n');

    // 创建节点
    for (const node of sortedNodes) {
        const parentUuid = node.parent ? nodeUuids.get(node.parent) : sceneData.data.uuid;

        console.log(`创建节点: ${node.name}`);
        if (node.parent) console.log(`  父节点: ${node.parent}`);

        // 创建节点
        const createResult = await callMCP('node_create_node', {
            name: node.name,
            parentUuid: parentUuid
        });

        const createData = JSON.parse(createResult.result.content[0].text);
        const uuid = createData.data.uuid;

        if (uuid) {
            nodeUuids.set(node.name, uuid);
            console.log(`  ✓ UUID: ${uuid}`);
        }

        // 设置位置
        if (node.position) {
            await callMCP('node_set_node_transform', {
                nodeUuid: uuid,
                position: {
                    x: node.position[0],
                    y: node.position[1],
                    z: node.position[2]
                }
            });
            console.log(`  ✓ 位置: (${node.position.join(', ')})`);
        }

        // 添加组件
        for (const comp of node.components) {
            try {
                console.log(`  添加组件: ${comp.type}`);
                await callMCP('component_add_component', {
                    nodeUuid: uuid,
                    componentType: comp.type
                });
                console.log(`    ✓ 已添加`);
            } catch (e) {
                console.log(`    ⚠ 跳过: ${e.message}`);
            }
        }

        console.log('');
    }

    // 创建预制体
    console.log('💾 保存预制体...');
    const rootUuid = nodeUuids.get(definition.name);

    if (rootUuid) {
        const prefabResult = await callMCP('prefab_create_prefab', {
            nodeUuid: rootUuid,
            prefabPath: definition.savePath
        });
        const prefabData = JSON.parse(prefabResult.result.content[0].text);
        console.log(`✓ 预制体已保存: ${definition.savePath}`);
        if (prefabData.data?.path) {
            console.log(`  文件路径: ${prefabData.data.path}`);
        }
    }

    console.log('\n✅ 完成！');
}

// 主函数
async function main() {
    const mdPath = process.argv[2] || 'assets/prefab-definitions/ShopItem.md';

    console.log('╔══════════════════════════════════════════╗');
    console.log('║   MD → MCP 预制体生成器                  ║');
    console.log('╚══════════════════════════════════════════╝\n');

    try {
        await generatePrefabFromMD(mdPath);
    } catch (error) {
        console.error('\n❌ 错误:', error.message);
        process.exit(1);
    }
}

main().catch(console.error);
