/**
 * MCP 连接测试脚本
 * 验证 cocos-mcp-server 是否可用
 */

const MCP_BASE_URL = 'http://127.0.0.1:3000/mcp';

/**
 * 调用 MCP 工具
 */
async function callMCP(toolName: string, args: any = {}): Promise<any> {
    try {
        const response = await fetch(MCP_BASE_URL, {
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

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        return result;
    } catch (error) {
        console.error(`❌ 调用失败: ${toolName}`, error);
        return null;
    }
}

/**
 * 测试服务器连接
 */
async function testConnection() {
    console.log('🔍 测试 MCP 服务器连接...\n');

    // 测试服务器信息
    console.log('1️⃣ 获取服务器信息...');
    const serverInfo = await callMCP('server_info', { action: 'getProjectInfo' });

    if (serverInfo) {
        console.log('✓ 服务器连接成功!');
        console.log('  项目信息:', serverInfo.result?.content?.[0]?.text?.substring(0, 100) + '...');
    } else {
        console.log('✗ 服务器连接失败');
        console.log('  请确保:');
        console.log('  1. Cocos Creator 已打开');
        console.log('  2. cocos-mcp-server 插件已启动');
        return false;
    }

    // 测试场景操作
    console.log('\n2️⃣ 获取当前场景...');
    const sceneInfo = await callMCP('scene_management', { action: 'getCurrentScene' });

    if (sceneInfo) {
        console.log('✓ 场景查询成功!');
    } else {
        console.log('✗ 场景查询失败');
    }

    // 测试节点查询
    console.log('\n3️⃣ 查询场景节点...');
    const hierarchy = await callMCP('scene_hierarchy', {
        action: 'get',
        includeComponents: false
    });

    if (hierarchy) {
        console.log('✓ 节点查询成功!');
    } else {
        console.log('✗ 节点查询失败');
    }

    console.log('\n✅ 测试完成! MCP 服务器可用。\n');
    return true;
}

/**
 * 交互式菜单
 */
async function interactiveMenu() {
    const readline = await import('readline');

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const question = (prompt: string): Promise<string> => {
        return new Promise(resolve => rl.question(prompt, resolve));
    };

    while (true) {
        console.log('\n📋 MCP 测试菜单');
        console.log('1. 测试连接');
        console.log('2. 创建测试节点');
        console.log('3. 获取场景层级');
        console.log('4. 获取预制体列表');
        console.log('0. 退出');

        const choice = await question('\n请选择 (0-4): ');

        switch (choice) {
            case '1':
                await testConnection();
                break;
            case '2':
                console.log('\n创建测试节点...');
                const createResult = await callMCP('node_lifecycle', {
                    action: 'create',
                    name: 'TestNode_' + Date.now(),
                    nodeType: '2DNode'
                });
                console.log('结果:', createResult?.result?.content?.[0]?.text);
                break;
            case '3':
                console.log('\n获取场景层级...');
                const hierarchy = await callMCP('scene_hierarchy', {
                    action: 'get',
                    includeComponents: false
                });
                console.log('结果:', hierarchy?.result?.content?.[0]?.text?.substring(0, 500));
                break;
            case '4':
                console.log('\n获取预制体列表...');
                const prefabs = await callMCP('prefab_browse', {
                    action: 'list'
                });
                console.log('结果:', prefabs?.result?.content?.[0]?.text);
                break;
            case '0':
                rl.close();
                console.log('再见!');
                return;
            default:
                console.log('无效选择');
        }
    }
}

// 主函数
async function main() {
    const args = process.argv.slice(2);

    if (args.includes('--interactive') || args.includes('-i')) {
        await interactiveMenu();
    } else {
        await testConnection();
    }
}

main().catch(console.error);
