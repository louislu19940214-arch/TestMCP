/**
 * Mock MCP Server - 用于独立测试预制体生成器
 * 模拟 cocos-mcp-server 的 HTTP 接口
 */

import http from 'http';

const PORT = 3000;

// 模拟的节点存储
const nodes = new Map<string, any>();
let nodeIdCounter = 1;

/**
 * 生成 UUID
 */
function generateUUID(): string {
    return `node-${nodeIdCounter++}-${Date.now()}`;
}

/**
 * 获取当前场景信息
 */
function getCurrentScene() {
    return {
        name: 'NewScene',
        uuid: 'scene-uuid-123',
        path: 'db://assets/NewScene.scene'
    };
}

/**
 * 创建节点
 */
function createNode(args: any) {
    const uuid = generateUUID();
    const node = {
        uuid,
        name: args.name || 'Node',
        parent: args.parentUuid || null,
        children: [],
        components: [],
        transform: {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 }
        }
    };

    nodes.set(uuid, node);

    // 如果有父节点，添加到父节点的 children
    if (args.parentUuid) {
        const parent = nodes.get(args.parentUuid);
        if (parent) {
            parent.children.push(uuid);
        }
    }

    console.log(`  ✓ 创建节点: ${node.name} (${uuid})`);

    return {
        success: true,
        uuid,
        node
    };
}

/**
 * 设置节点变换
 */
function setTransform(args: any) {
    console.log(`  ✓ 设置变换: ${args.nodeName || args.nodeUuid}`);

    // 简单实现，返回成功
    return {
        success: true
    };
}

/**
 * 添加组件
 */
function addComponent(args: any) {
    console.log(`  ✓ 添加组件: ${args.componentType} 到 ${args.nodeName || args.nodeUuid}`);

    return {
        success: true
    };
}

/**
 * 设置组件属性
 */
function setComponentProperty(args: any) {
    console.log(`  ✓ 设置属性: ${args.componentType}.${Object.keys(args.properties || {}).join(', ')}`);

    return {
        success: true
    };
}

/**
 * 创建预制体
 */
function createPrefab(args: any) {
    console.log(`  ✓ 创建预制体: ${args.prefabPath}`);

    // 保存预制体定义到文件（用于验证）
    const prefabData = {
        prefabPath: args.prefabPath,
        nodeUuid: args.nodeUuid,
        nodes: Array.from(nodes.entries()).map(([uuid, node]) => ({ uuid, ...node })),
        timestamp: new Date().toISOString()
    };

    return {
        success: true,
        prefabPath: args.prefabPath,
        prefabData
    };
}

/**
 * 处理工具调用
 */
function handleToolCall(toolName: string, args: any): any {
    console.log(`\n🔧 调用工具: ${toolName}`);

    switch (toolName) {
        case 'server_info':
            return {
                result: {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            project: 'TestMcp',
                            version: '1.0.0',
                            engine: 'Cocos Creator 3.8.8'
                        }, null, 2)
                    }]
                }
            };

        case 'scene_management':
            if (args.action === 'getCurrentScene') {
                return {
                    result: {
                        content: [{
                            type: 'text',
                            text: JSON.stringify(getCurrentScene(), null, 2)
                        }]
                    }
                };
            }
            break;

        case 'node_lifecycle':
            if (args.action === 'create') {
                const result = createNode(args);
                return {
                    result: {
                        content: [{
                            type: 'text',
                            text: result.uuid
                        }]
                    }
                };
            }
            break;

        case 'node_transform':
            if (args.action === 'setPosition') {
                const result = setTransform(args);
                return {
                    result: {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({ success: true })
                        }]
                    }
                };
            }
            break;

        case 'component_manage':
            if (args.action === 'add') {
                const result = addComponent(args);
                return {
                    result: {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({ success: true })
                        }]
                    }
                };
            }
            break;

        case 'set_component_property':
            const result = setComponentProperty(args);
            return {
                result: {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ success: true })
                    }]
                }
            };

        case 'prefab_lifecycle':
            if (args.action === 'createFromNode') {
                const result = createPrefab(args);
                return {
                    result: {
                        content: [{
                            type: 'text',
                            text: JSON.stringify(result, null, 2)
                        }]
                    }
                };
            }
            break;

        case 'scene_hierarchy':
            return {
                result: {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            nodes: Array.from(nodes.values())
                        }, null, 2)
                    }]
                }
            };

        default:
            return {
                error: {
                    code: -32601,
                    message: `Unknown tool: ${toolName}`
                }
            };
    }

    return {
        error: {
            code: -32601,
            message: `Unknown action: ${args.action}`
        }
    };
}

/**
 * HTTP 请求处理器
 */
function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.method === 'POST' && req.url === '/mcp') {
        let body = '';

        req.on('data', (chunk) => {
            body += chunk.toString();
        });

        req.on('end', () => {
            try {
                const jsonrpc = JSON.parse(body);
                console.log(`\n📨 收到请求:`, jsonrpc.method);

                let response: any;

                if (jsonrpc.method === 'tools/call') {
                    response = handleToolCall(
                        jsonrpc.params.name,
                        jsonrpc.params.arguments
                    );
                    response.id = jsonrpc.id;
                    response.jsonrpc = '2.0';
                } else if (jsonrpc.method === 'tools/list') {
                    response = {
                        jsonrpc: '2.0',
                        id: jsonrpc.id,
                        result: {
                            tools: [
                                { name: 'node_lifecycle', description: '节点生命周期管理' },
                                { name: 'node_transform', description: '节点变换操作' },
                                { name: 'component_manage', description: '组件管理' },
                                { name: 'set_component_property', description: '设置组件属性' },
                                { name: 'prefab_lifecycle', description: '预制体生命周期' },
                                { name: 'scene_management', description: '场景管理' },
                                { name: 'scene_hierarchy', description: '场景层级' },
                                { name: 'server_info', description: '服务器信息' }
                            ]
                        }
                    };
                } else {
                    response = {
                        jsonrpc: '2.0',
                        id: jsonrpc.id,
                        error: {
                            code: -32601,
                            message: `Unknown method: ${jsonrpc.method}`
                        }
                    };
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(response, null, 2));

            } catch (error) {
                console.error('❌ 处理请求错误:', error);
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
    } else if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', port: PORT }));
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
}

/**
 * 启动服务器
 */
function startServer() {
    const server = http.createServer(handleRequest);

    server.listen(PORT, '127.0.0.1', () => {
        console.log('╔══════════════════════════════════════════╗');
        console.log('║   Mock MCP Server 已启动                ║');
        console.log('╠══════════════════════════════════════════╣');
        console.log(`║   URL: http://127.0.0.1:${PORT}/mcp       ║`);
        console.log(`║   Health: http://127.0.0.1:${PORT}/health ║`);
        console.log('╚══════════════════════════════════════════╝');
        console.log('\n✅ 服务器就绪，等待连接...\n');
    });

    server.on('error', (error) => {
        console.error('❌ 服务器启动失败:', error);
        process.exit(1);
    });

    // 优雅关闭
    process.on('SIGINT', () => {
        console.log('\n\n🛑 正在关闭服务器...');
        server.close(() => {
            console.log('✅ 服务器已关闭');
            process.exit(0);
        });
    });
}

// 启动
startServer();
