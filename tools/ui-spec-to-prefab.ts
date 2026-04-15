/**
 * 从 psd-parse 生成的 ui-spec JSON，经 MCP（cocos-mcp-server）在场景中搭节点并保存为 Prefab。
 *
 * 依赖：Cocos Creator 已打开本项目，MCP 已启动（默认 http://127.0.0.1:8585/mcp）。
 */

import { readFile, readdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
        raw?: { paragraphStyle?: { justification?: string } };
    };
};

type UISpec = {
    version: 1;
    source: { psdPath: string; fileName: string };
    psd: { width: number; height: number };
    layers: UISpecLayer[];
    warnings: string[];
};

type PrefabObject = Record<string, any>;

function dbPathToFsPath(dbPath: string): string {
    if (!dbPath.startsWith('db://assets/')) {
        throw new Error(`仅支持 db://assets 路径，收到: ${dbPath}`);
    }
    const rel = dbPath.replace(/^db:\/\/assets\//, '').replaceAll('/', path.sep);
    // 在 ESM 环境下没有 __dirname，用 import.meta.url 计算当前文件目录
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(thisDir, '..', 'assets', rel);
}

async function postProcessPrefabLabels(prefabDbPath: string, spec: UISpec): Promise<void> {
    const fsPath = dbPathToFsPath(prefabDbPath);
    const txt = await readFile(fsPath, 'utf8');
    const arr = JSON.parse(txt) as PrefabObject[];
    if (!Array.isArray(arr)) return;

    // node __id__ -> node name（数组下标即 __id__）
    const nodeNameById = new Map<number, string>();
    for (let i = 0; i < arr.length; i++) {
        const o = arr[i];
        if (o && o.__type__ === 'cc.Node' && typeof o._name === 'string') nodeNameById.set(i, o._name);
    }

    // layerPath -> layer（用于计算 local pos）
    const layerByPath = new Map<string, UISpecLayer>();
    for (const l of spec.layers) layerByPath.set(l.path, l);

    // nodeName(layer.id) -> desired
    const desiredByNodeName = new Map<
        string,
        { fontSize: number; color: { r: number; g: number; b: number; a: number } }
    >();
    for (const layer of spec.layers) {
        if (layer.kind !== 'text') continue;
        const rawSize = layer.text?.font?.size;
        const fontSize = Math.max(8, Math.round(Number.isFinite(rawSize as number) ? (rawSize as number) : 20));
        const col = layer.text?.color ?? { r: 0, g: 0, b: 0, a: 255 };
        desiredByNodeName.set(layer.id, { fontSize, color: col });
    }

    // nodeName(layer.id) -> desired local position（prefab 里需要 _lpos）
    const desiredPosByNodeName = new Map<string, { x: number; y: number; z: number }>();
    for (const layer of spec.layers) {
        if (layer.kind === 'empty') continue;
        const { x: wx, y: wy, z } = layer.cocos.position;
        let x = wx;
        let y = wy;
        if (layer.parentPath) {
            const parentLayer = layerByPath.get(layer.parentPath);
            if (parentLayer) {
                x = wx - parentLayer.cocos.position.x;
                y = wy - parentLayer.cocos.position.y;
            }
        }
        desiredPosByNodeName.set(layer.id, { x, y, z: z ?? 0 });
    }

    let changed = false;
    for (const o of arr) {
        // 写回 Node 位置，避免“场景里正确但保存 prefab 后丢失位置”
        if (o && o.__type__ === 'cc.Node' && typeof o._name === 'string') {
            const dp = desiredPosByNodeName.get(o._name);
            if (dp) {
                o._lpos = { __type__: 'cc.Vec3', x: dp.x, y: dp.y, z: dp.z };
                changed = true;
            }
        }

        if (!o || o.__type__ !== 'cc.Label' || !o.node || typeof o.node.__id__ !== 'number') continue;
        const nodeName = nodeNameById.get(o.node.__id__);
        if (!nodeName) continue;
        const desired = desiredByNodeName.get(nodeName);
        if (!desired) continue;

        o._fontSize = desired.fontSize;
        o._actualFontSize = desired.fontSize;
        o._lineHeight = Math.max(o._lineHeight ?? 0, Math.round(desired.fontSize * 1.2));
        o._color = { __type__: 'cc.Color', r: desired.color.r, g: desired.color.g, b: desired.color.b, a: desired.color.a };
        changed = true;
    }

    if (changed) {
        await writeFile(fsPath, JSON.stringify(arr, null, 2), 'utf8');
        console.log(`已后处理写回 Node 位置 + Label 字体/颜色: ${prefabDbPath}`);
    }
}

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

async function tryReimportAsset(savePathDb: string): Promise<void> {
    // 不同版本插件的 AssetDB 工具命名/参数可能不同，这里做 best-effort 多路尝试。
    const attempts: Array<{ tool: string; args: Record<string, unknown> }> = [
        // 新版分类工具（README 提到）
        { tool: 'asset_operations', args: { action: 'reimport', url: savePathDb } },
        { tool: 'asset_operations', args: { action: 'reimport', path: savePathDb } },
        { tool: 'asset_system', args: { action: 'refresh', url: savePathDb } },
        { tool: 'asset_system', args: { action: 'refresh' } },

        // 兼容旧工具名（如果存在）
        { tool: 'asset_reimport_asset', args: { url: savePathDb } },
        { tool: 'asset_refresh_assets', args: {} }
    ];

    for (const a of attempts) {
        try {
            const r = await callMCP(a.tool, a.args);
            const p = parseToolPayload(r);
            if (p?.success === true) {
                console.log(`已触发资源重导入/刷新：${a.tool} ${JSON.stringify(a.args)}`);
                return;
            }
        } catch {
            // ignore
        }
    }
    console.warn(`⚠ 未能通过 MCP 自动触发 Reimport/Refresh（不影响生成）。如遇到 prefab 打开是旧数据，请手动右键 Reimport：${savePathDb}`);
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
    const candidates: Array<{ path: string; label: string }> = [];

    // 0) 若命令行显式指定 --rules，则仅使用该文件（完全接管，不再自动合并）
    if (rulesArg) {
        candidates.push({ path: path.resolve(rulesArg), label: 'cli' });
    } else {
        // 1) 全局 base rules（默认存在则启用）
        const baseRules = path.resolve(path.dirname(specAbs), 'base.rules.json');
        if (existsSync(baseRules)) candidates.push({ path: baseRules, label: 'base' });
    }
    const base = path.basename(specAbs, path.extname(specAbs));
    const auto = path.join(path.dirname(specAbs), `${base}.rules.json`);
    if (!rulesArg && existsSync(auto)) candidates.push({ path: auto, label: 'page' });

    const merged: ComponentRulesFile = { version: 1, layerNameRules: [] };
    let loadedAny = false;

    for (const c of candidates) {
        try {
            const raw = await readFile(c.path, 'utf8');
            const data = JSON.parse(raw) as ComponentRulesFile;
            if (data.version !== 1) continue;
            if (data.layerNameRules?.length) {
                merged.layerNameRules!.push(...data.layerNameRules);
            }
            loadedAny = true;
            console.log(`\n已加载组件规则(${c.label}): ${c.path}`);
        } catch {
            /* try next */
        }
    }
    if (!loadedAny || !merged.layerNameRules?.length) return null;
    return merged;
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

function mapLabelHorizontalAlign(justification?: string): number | undefined {
    if (!justification) return undefined;
    const j = justification.toLowerCase();
    // cc.Label.HorizontalAlign: LEFT=0, CENTER=1, RIGHT=2
    if (j === 'left' || j === 'justify-left') return 0;
    if (j === 'center' || j === 'justify-center') return 1;
    if (j === 'right' || j === 'justify-right') return 2;
    return undefined;
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
    const layerByPath = new Map<string, UISpecLayer>();
    for (const l of spec.layers) layerByPath.set(l.path, l);

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

        // spec 中的 cocos.position 是“以画布为参考的绝对坐标”（底左点）。
        // 但节点会按 parentPath 挂到父节点下，因此这里必须转成 local 坐标：childWorld - parentWorld
        const { x: wx, y: wy, z } = layer.cocos.position;
        let x = wx;
        let y = wy;
        if (layer.parentPath) {
            const parentLayer = layerByPath.get(layer.parentPath);
            if (parentLayer) {
                x = wx - parentLayer.cocos.position.x;
                y = wy - parentLayer.cocos.position.y;
            }
        }
        const tr = parseToolPayload(
            await callMCP('node_set_node_transform', {
                uuid: nodeUuid,
                position: { x, y, z: z ?? 0 }
            })
        );
        assertSuccess(tr, `node_set_node_transform(${id})`);

        // 某些情况下 node_set_node_transform 只改运行时，不会落到 prefab 序列化（_lpos）里。
        // 为避免“场景里看着对，但另存 prefab 又错”的问题，这里同步写入序列化字段。
        const lposPayload = parseToolPayload(
            await callMCP('node_set_node_property', {
                uuid: nodeUuid,
                property: '_lpos',
                value: { __type__: 'cc.Vec3', x, y, z: z ?? 0 }
            })
        );
        if (!lposPayload?.success) {
            // 不要 hard fail：不同版本 MCP 可能不允许写私有字段
            console.warn(`    ⚠ 写入 _lpos 失败（将仅依赖运行时 transform）: ${JSON.stringify(lposPayload)}`);
        }

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
            const rawSize = layer.text?.font?.size;
            const fontSize = Math.max(8, Math.round(Number.isFinite(rawSize as number) ? (rawSize as number) : 20));
            const col = layer.text?.color ?? { r: 0, g: 0, b: 0, a: 255 };

            // 兼容性处理：
            // - 有些版本/实现里，直接设运行时属性（fontSize/color）在保存 Prefab 时不会落盘到序列化字段
            // - 因此这里同时尝试设置运行时字段与序列化字段（带下划线），以确保最终 prefab 内容正确
            const labelProps: Array<[string, string, string | number | Record<string, number>]> = [
                ['string', 'string', text],
                ['_string', 'string', text],

                ['fontSize', 'number', fontSize],
                ['_fontSize', 'number', fontSize],
                ['_actualFontSize', 'number', fontSize],

                ['color', 'color', col],
                ['_color', 'color', col]
            ];

            const hAlign = mapLabelHorizontalAlign(layer.text?.raw?.paragraphStyle?.justification);
            if (hAlign !== undefined) {
                labelProps.push(['horizontalAlign', 'number', hAlign]);
                labelProps.push(['_horizontalAlign', 'number', hAlign]);
            }

            for (const [prop, ptype, val] of labelProps) {
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

            // 同步设置节点颜色（有些情况下编辑器“另存 prefab”会以 Node.color 为准回写）
            const nodeColorPayload = parseToolPayload(
                await callMCP('node_set_node_property', {
                    uuid: nodeUuid,
                    property: 'color',
                    value: { r: col.r, g: col.g, b: col.b, a: col.a }
                })
            );
            if (!nodeColorPayload?.success) {
                console.warn(`    ⚠ 设置 Node.color 失败（可忽略）：${JSON.stringify(nodeColorPayload)}`);
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

    // 二次修正：确保 Label 的字体大小/颜色最终落盘（部分版本下 MCP 修改不会被 prefab 序列化捕获）
    try {
        await postProcessPrefabLabels(prefabPath, spec);
    } catch (e) {
        console.warn(`⚠ Prefab 后处理失败（可忽略，不影响生成）：${(e as Error)?.message ?? String(e)}`);
    }

    // 触发资源库刷新：避免“scene 里对，但点开 prefab 还是旧数据，需要手动 Reimport”
    try {
        await tryReimportAsset(prefabPath);
    } catch (e) {
        console.warn(`⚠ 自动 Reimport/Refresh 失败（可忽略）：${(e as Error)?.message ?? String(e)}`);
    }

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
