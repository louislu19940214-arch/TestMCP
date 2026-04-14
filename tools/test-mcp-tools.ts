/**
 * 测试 MCP 工具返回格式
 */

const MCP_URL = 'http://localhost:8585/mcp';

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
    return result;
}

async function main() {
    console.log('测试 scene_get_current_scene:\n');

    const result = await callMCP('scene_get_current_scene', {});
    console.log('完整返回:', JSON.stringify(result, null, 2));

    console.log('\n---\n');
    console.log('result.result:', result.result);

    console.log('\n---\n');
    console.log('result.result?.content:', result.result?.content);
}

main().catch(console.error);
