/**
 * 从 psd-parse 生成的 ui-spec JSON，经 MCP（cocos-mcp-server）在场景中搭节点并保存为 Prefab。
 *
 * 依赖：Cocos Creator 已打开本项目，MCP 已启动（默认 http://127.0.0.1:8585/mcp）。
 */

import { readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const MCP_BASE_URL = process.env.COCOS_MCP_URL ?? 'http://127.0.0.1:8585/mcp';

type OriginMode = 'center' | 'topleft';

type UISpecLayer = {
    id: string;
    kind: 'group' | 'text' | 'pixel' | 'empty';
    name: string;
    path: string;
    parentPath: string | null;
    visible: boolean;
    opacity: number;
    psd: { left: number; top: number; width: number; height: number; right: number; bottom: number };
    cocos: {
        origin: OriginMode;
        position: { x: number; y: number; z: number };
        size: { width: number; height: number };
    };
    text?: {
        content: string;
        font?: { name?: string; size?: number };
        color?: { r: number; g: number; b: number; a: number };
    };
};

type UISpec = {
    version: 1;
    source: { psdPath: string; fileName: string };
    psd: { width: number; height: number };
    layers: UISpecLayer[];
    warnings: string[];
};

/** 与 ui-spec 同目录、同主文件名：如 testView.rules.json，由脚本自动加载（也可用 --rules 指定） */
type ComponentRulesFile = {
    version: 1;
    layerNameRules?: Array<{
        /** 对图层名（name）做匹配，如 "btn" */
        regex: string;
        /** 传给 RegExp 第二参数，如 "i" 表示忽略大小写（勿用 (?i) 内联，JS 不支持） */
        flags?: string;
        /** 仅当图层类型匹配时应用；缺省为 any */
        when?: 'pixel' | 'text' | 'group' | 'any';
        /** 依次添加，如 ["cc.Button"] */
        addComponents?: string[];
        /** 添加后依次 set_component_property */
        setProperties?: Array<{
            componentType: string;
            property: string;
            propertyType: string;
            value: unknown;
        }>;
    }>;
};

function printUsageAndExit(code = 1): never {
    console.log(`用法:
  npx tsx ui-spec-to-prefab.ts <ui-spec.json> [--prefab db://assets/prefabs/XXX.prefab] [--texture-dir <绝对路径>] [--rules <规则.json>]

默认:
  --prefab db://assets/prefabs/<spec文件名>_fromPsd.prefab
  --texture-dir <spec 所在目录>/../Texture  （例如 assets/ui-spec/../Texture）
  --rules 缺省时若存在 <spec 同主名>.rules.json 则自动加载（见 assets/ui-spec/RULES.md）
`);
    process.exit(code);
}

function parseArgs(argv: string[]) {
    const positional: string[] = [];
    const kv = new Map<string, string>();
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--help' || a === '-h') printUsageAndExit(0);
        if (a === '--prefab' || a === '--texture-dir' || a === '--rules') {
            const v = argv[i + 1];
            if (!v || v.startsWith('--')) printUsageAndExit(1);
            kv.set(a, v);
            i++;
            continue;
        }
        positional.push(a);
    }
    const specPath = positional[0];
    if (!specPath) printUsageAndExit(1);
    return { specPath, prefab: kv.get('--prefab'), textureDir: kv.get('--texture-dir'), rules: kv.get('--rules') };
}

async function callMCP(toolName: string, args: Record<string, unknown>): Promise<any> {
    const res = await fetch(MCP_BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'tools/call',
            params: { name: toolName, arguments: args }
        })
    });
    const json = await res.json();
    if (json.error) throw new Error(`MCP: ${json.error.message || JSON.stringify(json.error)}`);
    return json;
}

function parseToolPayload(result: any): any {
    const text = result?.result?.content?.[0]?.text;
    if (text == null || text === '') return null;
    try {
        return JSON.parse(text);
    } catch {
        return { raw: text };
    }
}

function assertSuccess(payload: any, ctx: string): void {
    if (!payload || payload.success !== true) {
        throw new Error(`${ctx} 失败: ${JSON.stringify(payload)}`);
    }
}

/**
 * 从图片资源的 .meta 中读取默认 SpriteFrame 的 uuid（形如 base@f9941）。
 * MCP 的 propertyType=spriteFrame 会把字符串当作「资源 UUID」，传 db:// 路径会写进 prefab 导致紫图。
 */
async function readSpriteFrameUuidFromImageMeta(imageAbsPath: string): Promise<string | undefined> {
    try {
        const metaText = await readFile(`${imageAbsPath}.meta`, 'utf8');
        const meta = JSON.parse(metaText) as { subMetas?: Record<string, { importer?: string; uuid?: string }> };
        const sub = meta.subMetas ?? {};
        for (const sm of Object.values(sub)) {
            if (sm.importer === 'sprite-frame' && sm.uuid) return sm.uuid;
        }
    } catch {
        // 无 meta 或未导入
    }
    return undefined;
}

/** 图层名小写 → SpriteFrame uuid（Cocos 子资源 uuid） */
async function loadSpriteFrameUuidMap(textureAbsDir: string): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    let files: string[] = [];
    try {
        files = await readdir(textureAbsDir);
    } catch {
        console.warn(`⚠ 无法读取贴图目录: ${textureAbsDir}`);
        return map;
    }
    for (const f of files) {
        if (!/\.(png|jpg|jpeg)$/i.test(f)) continue;
        const base = f.replace(/\.(png|jpg|jpeg)$/i, '').toLowerCase();
        const abs = path.join(textureAbsDir, f);
        const sf = await readSpriteFrameUuidFromImageMeta(abs);
        if (sf) map.set(base, sf);
    }
    return map;
}

function pickSpriteFrameUuid(layerName: string, sfByBase: Map<string, string>): string | undefined {
    const raw = layerName.trim().toLowerCase().replace(/\s+/g, '_');
    if (sfByBase.has(raw)) return sfByBase.get(raw);
    const stripped = raw.replace(/^(img|spr|pic)_/i, '');
    if (sfByBase.has(stripped)) return sfByBase.get(stripped);
    return undefined;
}

function depthOf(pathStr: string): number {
    return pathStr.split('/').filter(Boolean).length;
}

async function loadComponentRules(
    specAbs: string,
    rulesArg: string | undefined
): Promise<ComponentRulesFile | null> {
    const candidates: string[] = [];
    if (rulesArg) candidates.push(path.resolve(rulesArg));
    const base = path.basename(specAbs, path.extname(specAbs));
    const auto = path.join(path.dirname(specAbs), `${base}.rules.json`);
    if (!rulesArg && existsSync(auto)) candidates.push(auto);

    for (const p of candidates) {
        try {
            const raw = await readFile(p, 'utf8');
            const data = JSON.parse(raw) as ComponentRulesFile;
            if (data.version !== 1) continue;
            console.log(`\n已加载组件规则: ${p}`);
            return data;
        } catch {
            /* try next */
        }
    }
    return null;
}

async function applyLayerNameRules(
    layer: UISpecLayer,
    nodeUuid: string,
    rules: ComponentRulesFile | null
): Promise<void> {
    if (!rules?.layerNameRules?.length) return;

    for (const rule of rules.layerNameRules) {
        const when = rule.when ?? 'any';
        if (when !== 'any' && when !== layer.kind) continue;

        let re: RegExp;
        try {
            re = new RegExp(rule.regex, rule.flags ?? '');
        } catch {
            console.warn(`⚠ 无效正则，已跳过: /${rule.regex}/${rule.flags ?? ''}`);
            continue;
        }
        if (!re.test(layer.name)) continue;

        console.log(`    → 规则命中 "${rule.regex}"，图层 "${layer.name}"`);

        for (const ct of rule.addComponents ?? []) {
            const addPayload = parseToolPayload(
                await callMCP('component_add_component', { nodeUuid, componentType: ct })
            );
            if (!addPayload?.success) {
                console.warn(`      ⚠ 添加组件 ${ct}: ${JSON.stringify(addPayload)}`);
            }
            await sleep(25);
        }

        for (const sp of rule.setProperties ?? []) {
            const p = parseToolPayload(
                await callMCP('component_set_component_property', {
                    nodeUuid,
                    componentType: sp.componentType,
                    property: sp.property,
                    propertyType: sp.propertyType,
                    value: sp.value
                })
            );
            if (!p?.success) {
                console.warn(`      ⚠ 设置属性 ${sp.componentType}.${sp.property}: ${JSON.stringify(p)}`);
            }
            await sleep(20);
        }
    }
}

async function sleep(ms: number) {
    await new Promise(r => setTimeout(r, ms));
}

async function main() {
    const { specPath, prefab: prefabArg, textureDir: textureArg, rules: rulesArg } = parseArgs(process.argv);
    const specAbs = path.resolve(specPath);
    const raw = await readFile(specAbs, 'utf8');
    const spec = JSON.parse(raw) as UISpec;

    if (!spec.layers?.length) {
        throw new Error('UI Spec 中没有 layers 数据');
    }

    const baseName = path.basename(specAbs, path.extname(specAbs));
    const prefabPath =
        prefabArg ?? `db://assets/prefabs/${baseName}_fromPsd.prefab`;
    const textureAbs =
        textureArg ?? path.resolve(path.dirname(specAbs), '..', 'Texture');

    const spriteFrameMap = await loadSpriteFrameUuidMap(textureAbs);
    console.log(`贴图目录: ${textureAbs}（已解析 ${spriteFrameMap.size} 个 SpriteFrame uuid）`);

    const componentRules = await loadComponentRules(specAbs, rulesArg);

    const sceneResult = await callMCP('scene_get_current_scene', {});
    const scenePayload = parseToolPayload(sceneResult);
    assertSuccess(scenePayload, 'scene_get_current_scene');
    const sceneUuid = scenePayload.data?.uuid as string;
    if (!sceneUuid) throw new Error('无法解析场景 UUID');

    const rootId = `${baseName}Root`;
    const uuidById = new Map<string, string>();

    // 同深度时保留 JSON 中的顺序（与 PSD 遍历顺序一致），避免按名字排序打乱叠放顺序
    const sorted = spec.layers
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => l.kind !== 'empty')
        .sort((a, b) => {
            const da = depthOf(a.l.path);
            const db = depthOf(b.l.path);
            if (da !== db) return da - db;
            return a.i - b.i;
        })
        .map(x => x.l);

    console.log(`\n创建根节点: ${rootId}`);
    const rootCreate = parseToolPayload(
        await callMCP('node_create_node', {
            name: rootId,
            parentUuid: sceneUuid,
            nodeType: '2DNode',
            // MCP 侧对 2DNode 的默认组件处理不稳定，显式挂上 UITransform
            components: ['cc.UITransform']
        })
    );
    assertSuccess(rootCreate, 'node_create_node(root)');
    const rootUuid = rootCreate.data?.uuid as string;
    if (!rootUuid) throw new Error('根节点无 UUID');
    uuidById.set(rootId, rootUuid);

    const pw = spec.psd?.width || 750;
    const ph = spec.psd?.height || 1334;

    await callMCP('node_set_node_transform', {
        uuid: rootUuid,
        position: { x: 0, y: 0, z: 0 }
    });
    const rootSizePayload = parseToolPayload(
        await callMCP('component_set_component_property', {
            nodeUuid: rootUuid,
            componentType: 'cc.UITransform',
            property: 'contentSize',
            propertyType: 'size',
            value: { width: pw, height: ph }
        })
    );
    assertSuccess(rootSizePayload, 'component_set_component_property(UITransform root size)');

    for (const layer of sorted) {
        const id = layer.id;
        const parentKey = layer.parentPath ? pathToId(layer.parentPath) : rootId;
        const parentUuid = uuidById.get(parentKey);
        if (!parentUuid) {
            console.warn(`⚠ 跳过（找不到父）: ${layer.path} parentKey=${parentKey}`);
            continue;
        }

        console.log(`\n节点 [${layer.kind}] ${id}  (${layer.name})`);

        const createPayload = parseToolPayload(
            await callMCP('node_create_node', {
                name: id,
                parentUuid,
                nodeType: '2DNode',
                components: ['cc.UITransform']
            })
        );
        assertSuccess(createPayload, `node_create_node(${id})`);
        const nodeUuid = createPayload.data?.uuid as string;
        if (!nodeUuid) throw new Error(`节点 ${id} 无 UUID`);
        uuidById.set(id, nodeUuid);

        await sleep(40);

        const { x, y, z } = layer.cocos.position;
        const tr = parseToolPayload(
            await callMCP('node_set_node_transform', {
                uuid: nodeUuid,
                position: { x, y, z: z ?? 0 }
            })
        );
        assertSuccess(tr, `node_set_node_transform(${id})`);

        let w = Math.max(1, Math.round(layer.cocos.size.width));
        let h = Math.max(1, Math.round(layer.cocos.size.height));
        if (layer.kind === 'group' && (w <= 1 || h <= 1)) {
            w = Math.max(w, 2);
            h = Math.max(h, 2);
        }

        const sizePayload = parseToolPayload(
            await callMCP('component_set_component_property', {
                nodeUuid,
                componentType: 'cc.UITransform',
                property: 'contentSize',
                propertyType: 'size',
                value: { width: w, height: h }
            })
        );
        assertSuccess(sizePayload, `UITransform size(${id})`);

        if (!layer.visible) {
            const ap = parseToolPayload(
                await callMCP('node_set_node_property', {
                    uuid: nodeUuid,
                    property: 'active',
                    value: false
                })
            );
            assertSuccess(ap, `node_set_node_property(active=false, ${id})`);
        }

        if (layer.kind === 'pixel') {
            const sfUuid = pickSpriteFrameUuid(layer.name, spriteFrameMap);
            const addSp = parseToolPayload(
                await callMCP('component_add_component', {
                    nodeUuid,
                    componentType: 'cc.Sprite'
                })
            );
            assertSuccess(addSp, `add_component(cc.Sprite, ${id})`);
            if (sfUuid) {
                const sp = parseToolPayload(
                    await callMCP('component_set_component_property', {
                        nodeUuid,
                        componentType: 'cc.Sprite',
                        property: 'spriteFrame',
                        propertyType: 'spriteFrame',
                        value: sfUuid
                    })
                );
                assertSuccess(sp, `spriteFrame(${id})`);
            } else {
                console.warn(
                    `    ⚠ 未匹配到 SpriteFrame：图层名 "${layer.name}"（需在 Texture 下有同名 png/jpg 且已导入生成 .meta）`
                );
            }

            await applyLayerNameRules(layer, nodeUuid, componentRules);
        }

        if (layer.kind === 'text') {
            const addLb = parseToolPayload(
                await callMCP('component_add_component', {
                    nodeUuid,
                    componentType: 'cc.Label'
                })
            );
            assertSuccess(addLb, `add_component(cc.Label, ${id})`);

            const text = layer.text?.content ?? '';
            const fontSize = Math.max(8, Math.round(layer.text?.font?.size ?? 20));
            const col = layer.text?.color ?? { r: 0, g: 0, b: 0, a: 255 };

            for (const [prop, ptype, val] of [
                ['string', 'string', text],
                ['fontSize', 'number', fontSize],
                ['color', 'color', col]
            ] as const) {
                const p = parseToolPayload(
                    await callMCP('component_set_component_property', {
                        nodeUuid,
                        componentType: 'cc.Label',
                        property: prop,
                        propertyType: ptype,
                        value: val
                    })
                );
                assertSuccess(p, `Label ${prop}(${id})`);
            }

            await applyLayerNameRules(layer, nodeUuid, componentRules);
        }

        if (layer.kind === 'group') {
            await applyLayerNameRules(layer, nodeUuid, componentRules);
        }

        await sleep(30);
    }

    console.log(`\n生成 Prefab: ${prefabPath}`);
    const prefabPayload = parseToolPayload(
        await callMCP('prefab_create_prefab', {
            nodeUuid: rootUuid,
            savePath: prefabPath,
            prefabName: baseName
        })
    );
    assertSuccess(prefabPayload, 'prefab_create_prefab');

    console.log('\n✅ 完成。若场景里已有同名节点，请先手动清理或改名后再试。');
}

/** 与 psd-parse 中 path → id 规则一致：整段 path 做 sanitize */
function pathToId(p: string): string {
    return p.replace(/[\\/:*?"<>|/]/g, '_').replace(/\s+/g, '_').trim();
}

main().catch(e => {
    console.error('\n❌', e?.message || e);
    process.exit(1);
});
