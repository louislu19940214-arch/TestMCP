/**
 * PSD → JSON（UI Spec）
 *
 * 目标：把 PSD 解析成稳定的中间结构（JSON），供后续生成 MD / MCP 预制体调用序列。
 *
 * 默认会跳过图层像素数据（更快、更省内存）。如需后续导出切图，请使用 --include-image-data。
 */

import PSD, { initializeCanvas, type Color, type Layer, type LayerTextData, type Psd } from 'ag-psd';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

type OriginMode = 'center' | 'topleft';

type CliArgs = {
    inputPsd: string;
    outJson?: string;
    outMd?: boolean;
    includeImageData: boolean;
    origin: OriginMode;
};

function printUsageAndExit(code = 1): never {
    console.log(`用法:
  npx tsx psd-parse.ts <input.psd> [--out <output.json>] [--md] [--include-image-data] [--origin center|topleft]

示例:
  npx tsx psd-parse.ts ..\\design\\Shop.psd --out ..\\assets\\ui-spec\\Shop.json --md --origin center

说明:
  - 默认 --origin center：坐标以 PSD 画布中心为原点（更接近你们现有 psd-to-prefab 脚本的做法）
  - --origin topleft：坐标以 PSD 左上角为原点（便于和某些切图/标注工具对齐）
  - --md：额外输出同名 .md（人类可读审阅）
`);
    process.exit(code);
}

function parseArgs(argv: string[]): CliArgs {
    const positional: string[] = [];
    const flags = new Set<string>();
    const kv = new Map<string, string>();

    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--help' || a === '-h') printUsageAndExit(0);
        if (a.startsWith('--')) {
            const key = a;
            const next = argv[i + 1];
            if (key === '--out' || key === '--origin') {
                if (!next || next.startsWith('--')) printUsageAndExit(1);
                kv.set(key, next);
                i++;
                continue;
            }
            flags.add(key);
            continue;
        }
        positional.push(a);
    }

    const inputPsd = positional[0];
    if (!inputPsd) printUsageAndExit(1);

    const originRaw = kv.get('--origin') || 'center';
    if (originRaw !== 'center' && originRaw !== 'topleft') printUsageAndExit(1);

    return {
        inputPsd,
        outJson: kv.get('--out'),
        outMd: flags.has('--md'),
        includeImageData: flags.has('--include-image-data'),
        origin: originRaw
    };
}

function sanitizeFileBaseName(name: string): string {
    // 含 `/` 的图层路径必须展开，否则不适合作为节点名 / 文件名
    return name.replace(/[\\/:*?"<>|/]/g, '_').replace(/\s+/g, '_').trim();
}

function isGroupLayer(layer: Layer): boolean {
    // ag-psd 通常用 children 表示图层组；部分文件/版本也可能带 layerType 字段（运行时扩展）
    if (layer.children && layer.children.length > 0) return true;
    return (layer as any).layerType === 'group';
}

type Bounds = { left: number; top: number; right: number; bottom: number; width: number; height: number };

function makeBounds(left: number, top: number, right: number, bottom: number): Bounds {
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    return { left, top, right, bottom, width, height };
}

function readRawBounds(layer: Layer): Bounds {
    const left = layer.left ?? 0;
    const top = layer.top ?? 0;
    const right = layer.right ?? left;
    const bottom = layer.bottom ?? top;
    return makeBounds(left, top, right, bottom);
}

function computeEffectiveBounds(layer: Layer): Bounds {
    const raw = readRawBounds(layer);
    // 普通图层 raw 通常可靠；组图层 raw 常为 0，需要用子图层 union
    if (!isGroupLayer(layer)) return raw;

    const children = layer.children ?? [];
    if (children.length === 0) return raw;

    let minL = Number.POSITIVE_INFINITY;
    let minT = Number.POSITIVE_INFINITY;
    let maxR = Number.NEGATIVE_INFINITY;
    let maxB = Number.NEGATIVE_INFINITY;
    let hasAny = false;

    for (const c of children) {
        const b = computeEffectiveBounds(c);
        if (b.width <= 0 || b.height <= 0) continue;
        hasAny = true;
        minL = Math.min(minL, b.left);
        minT = Math.min(minT, b.top);
        maxR = Math.max(maxR, b.right);
        maxB = Math.max(maxB, b.bottom);
    }

    if (!hasAny) return raw;
    return makeBounds(minL, minT, maxR, maxB);
}

function normalizeOpacity(layer: Layer): number {
    // ag-psd 的 opacity 通常是 0..255；但也可能遇到 0..1 的变体，做个保守归一化
    const o = layer.opacity;
    if (o == null) return 1;
    if (o > 1) return Math.max(0, Math.min(1, o / 255));
    return Math.max(0, Math.min(1, o));
}

function classifyLayer(layer: Layer): 'group' | 'text' | 'pixel' | 'empty' {
    if (isGroupLayer(layer)) return 'group';
    if (layer.text) return 'text';

    const left = layer.left ?? 0;
    const top = layer.top ?? 0;
    const right = layer.right ?? left;
    const bottom = layer.bottom ?? top;
    const w = Math.max(0, right - left);
    const h = Math.max(0, bottom - top);
    if (w <= 0 || h <= 0) return 'empty';

    // 没有像素数据也不一定是空层（可能被 skip），这里仍归类为 pixel，由 warnings 提示
    return 'pixel';
}

type UISpecLayer = {
    id: string;
    kind: 'group' | 'text' | 'pixel' | 'empty';
    name: string;
    path: string;
    parentPath: string | null;

    visible: boolean;
    opacity: number;

    // PSD 像素坐标（左上角原点，y 向下）
    psd: {
        left: number;
        top: number;
        width: number;
        height: number;
        right: number;
        bottom: number;
    };

    // Cocos 友好坐标（y 向上，origin 由参数控制）
    cocos: {
        origin: OriginMode;
        position: { x: number; y: number; z: number }; // 默认 z=0；位置对应 layer 包围盒左下角（UI 常用）
        size: { width: number; height: number };
    };

    text?: {
        content: string;
        font?: {
            name?: string;
            size?: number;
        };
        color?: { r: number; g: number; b: number; a: number };
        fillColorRaw?: Color;
        // 保留 ag-psd 解析后的原始结构，便于对照 PSD/排查差异
        raw?: Pick<LayerTextData, 'style' | 'styleRuns' | 'paragraphStyle' | 'paragraphStyleRuns' | 'warp' | 'antiAlias'>;
    };

    flags: {
        hasImageData: boolean;
    };
};

type UISpec = {
    version: 1;
    generator: { name: string; version: string };
    source: { psdPath: string; fileName: string };
    psd: {
        width: number;
        height: number;
        channels?: number;
        bitsPerChannel?: number;
        colorMode?: number;
    };
    options: {
        includeImageData: boolean;
        origin: OriginMode;
    };
    layers: UISpecLayer[];
    warnings: string[];
};

function clamp255(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(255, Math.round(n)));
}

function normalizeTo255(v: number): number {
    // ag-psd 的颜色可能是 0..255、0..1、0..100 等；这里做“尽力”归一化
    if (!Number.isFinite(v)) return 0;
    if (v <= 1) return v * 255;
    if (v <= 100) return (v / 100) * 255;
    return v;
}

function hsbToRgb(h: number, s: number, b: number): { r: number; g: number; b: number } {
    // h: 0..360, s/b: 0..1 or 0..100
    const hh = ((h % 360) + 360) % 360;
    const ss = normalizeTo255(s) / 255;
    const vv = normalizeTo255(b) / 255;
    const c = vv * ss;
    const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
    const m = vv - c;
    let rp = 0, gp = 0, bp = 0;
    if (hh < 60) [rp, gp, bp] = [c, x, 0];
    else if (hh < 120) [rp, gp, bp] = [x, c, 0];
    else if (hh < 180) [rp, gp, bp] = [0, c, x];
    else if (hh < 240) [rp, gp, bp] = [0, x, c];
    else if (hh < 300) [rp, gp, bp] = [x, 0, c];
    else [rp, gp, bp] = [c, 0, x];
    return { r: (rp + m) * 255, g: (gp + m) * 255, b: (bp + m) * 255 };
}

function cmykToRgb(c: number, m: number, y: number, k: number): { r: number; g: number; b: number } {
    // c/m/y/k: 0..1 or 0..100 or 0..255（尽力归一化到 0..1 再换算）
    const cc = normalizeTo255(c) / 255;
    const mm = normalizeTo255(m) / 255;
    const yy = normalizeTo255(y) / 255;
    const kk = normalizeTo255(k) / 255;
    return {
        r: (1 - Math.min(1, cc * (1 - kk) + kk)) * 255,
        g: (1 - Math.min(1, mm * (1 - kk) + kk)) * 255,
        b: (1 - Math.min(1, yy * (1 - kk) + kk)) * 255
    };
}

function tryExtractRgbColor(color: Color | undefined): { r: number; g: number; b: number; a: number } | undefined {
    if (!color) return undefined;
    // 这里只“尽力”提取 RGBA；遇到 LAB 等复杂颜色时保留 fillColorRaw 供人工对照
    const c: any = color as any;

    // RGB / RGBA（常见）
    if (typeof c.r === 'number' && typeof c.g === 'number' && typeof c.b === 'number') {
        const a = typeof c.a === 'number' ? normalizeTo255(c.a) : 255;
        return { r: clamp255(c.r), g: clamp255(c.g), b: clamp255(c.b), a: clamp255(a) };
    }

    // FRGB：0..1 浮点（常见于某些文本/效果数据）
    if (typeof c.fr === 'number' && typeof c.fg === 'number' && typeof c.fb === 'number') {
        return {
            r: clamp255(normalizeTo255(c.fr)),
            g: clamp255(normalizeTo255(c.fg)),
            b: clamp255(normalizeTo255(c.fb)),
            a: 255
        };
    }

    // Grayscale
    if (typeof c.k === 'number') {
        const v = clamp255(normalizeTo255(c.k));
        return { r: v, g: v, b: v, a: 255 };
    }

    // HSB
    if (typeof c.h === 'number' && typeof c.s === 'number' && typeof c.b === 'number') {
        const rgb = hsbToRgb(c.h, c.s, c.b);
        return { r: clamp255(rgb.r), g: clamp255(rgb.g), b: clamp255(rgb.b), a: 255 };
    }

    // CMYK
    if (typeof c.c === 'number' && typeof c.m === 'number' && typeof c.y === 'number' && typeof c.k === 'number') {
        const rgb = cmykToRgb(c.c, c.m, c.y, c.k);
        return { r: clamp255(rgb.r), g: clamp255(rgb.g), b: clamp255(rgb.b), a: 255 };
    }

    return undefined;
}

function extractText(layer: Layer): UISpecLayer['text'] | undefined {
    if (!layer.text) return undefined;

    const primaryStyle = layer.text.style;
    const run0Style = layer.text.styleRuns?.[0]?.style;

    let fontName = primaryStyle?.font?.name ?? run0Style?.font?.name;
    // Photoshop 占位/不可见字体名，ag-psd 可能解析为 AdobeInvisFont；对 Cocos 无意义，避免写进 spec
    if (fontName && /invisfont/i.test(fontName.replace(/\s+/g, ''))) {
        fontName = undefined;
    }
    const fontSize = primaryStyle?.fontSize ?? run0Style?.fontSize;

    const fillColorRaw = (primaryStyle?.fillColor ?? run0Style?.fillColor) as Color | undefined;
    let fillColor = tryExtractRgbColor(fillColorRaw);

    // 备用：部分 PSD 用“颜色叠加/纯色填充”等图层效果实现字体颜色（而非 text style 的 fillColor）
    if (!fillColor) {
        const eff: any = (layer as any).effects;
        const candidates: any[] = [
            eff?.solidFill?.color, // 纯色填充/颜色叠加
            eff?.stroke?.color, // 描边颜色（不一定是主颜色）
            eff?.outerGlow?.color,
            eff?.innerGlow?.color,
            eff?.dropShadow?.color
        ].filter(Boolean);
        for (const cand of candidates) {
            const c = tryExtractRgbColor(cand as Color);
            if (c) {
                fillColor = c;
                break;
            }
        }
    }

    // 某些 PSD 的文本 style 中不包含 fillColor（ag-psd 解析限制/或数据缺失）。
    // 若开启了 useImageData（--include-image-data），尝试从文本图层像素“估算”颜色（取非透明像素平均值）。
    if (!fillColor) {
        const img: any = (layer as any).imageData;
        if (img && img.data && typeof img.width === 'number' && typeof img.height === 'number') {
            try {
                const data: any = img.data;
                const len = data.length | 0;
                let r = 0, g = 0, b = 0, a = 0, n = 0;
                // data 通常为 Uint8ClampedArray，RGBA 交错
                for (let i = 0; i + 3 < len; i += 4) {
                    const aa = data[i + 3] as number;
                    if (aa <= 10) continue; // 忽略近透明像素
                    r += data[i] as number;
                    g += data[i + 1] as number;
                    b += data[i + 2] as number;
                    a += aa;
                    n++;
                }
                if (n > 0) {
                    fillColor = {
                        r: clamp255(r / n),
                        g: clamp255(g / n),
                        b: clamp255(b / n),
                        a: clamp255(a / n)
                    };
                }
            } catch {
                // ignore
            }
        }
    }

    return {
        content: layer.text.text ?? '',
        font: {
            name: fontName,
            size: fontSize
        },
        color: fillColor,
        fillColorRaw,
        raw: {
            style: layer.text.style,
            styleRuns: layer.text.styleRuns,
            paragraphStyle: layer.text.paragraphStyle,
            paragraphStyleRuns: layer.text.paragraphStyleRuns,
            warp: layer.text.warp,
            antiAlias: layer.text.antiAlias
        }
    };
}

function walkLayers(
    layer: Layer,
    parentPath: string | null,
    origin: OriginMode,
    includeImageData: boolean,
    out: UISpecLayer[],
    warnings: string[]
): void {
    const name = layer.name || 'Unnamed';
    const path = parentPath ? `${parentPath}/${name}` : name;

    const b = computeEffectiveBounds(layer);
    const left = b.left;
    const top = b.top;
    const right = b.right;
    const bottom = b.bottom;
    const width = b.width;
    const height = b.height;

    const kind = classifyLayer(layer);
    const id = sanitizeFileBaseName(path);

    const hasImageData = Boolean((layer as any).canvas || (layer as any).imageData);

    if (kind === 'pixel' && !includeImageData && !hasImageData) {
        warnings.push(`图层 "${path}" 被归类为像素层，但当前未包含 imageData（默认 skipLayerImageData=true）。如需导出切图，请加 --include-image-data 重新解析。`);
    }

    out.push({
        id,
        kind,
        name,
        path,
        parentPath,
        visible: layer.hidden !== true,
        opacity: normalizeOpacity(layer),
        psd: { left, top, width, height, right, bottom },
        cocos: {
            origin,
            // position 会在 fixCocosPositions 中统一写入（需要 psdWidth + psdHeight）
            position: { x: 0, y: 0, z: 0 },
            size: { width, height }
        },
        text: extractText(layer),
        flags: { hasImageData }
    });

    if (layer.children && layer.children.length > 0) {
        for (const child of layer.children) {
            walkLayers(child, path, origin, includeImageData, out, warnings);
        }
    }
}

function fixCocosPositions(spec: UISpec, psdWidth: number, psdHeight: number): void {
    const centerX = psdWidth / 2;
    const centerY = psdHeight / 2;

    for (const layer of spec.layers) {
        const left = layer.psd.left;
        const top = layer.psd.top;
        const w = layer.psd.width;
        const h = layer.psd.height;

        // Cocos 2D/UI 节点默认以“节点中心点”为位置（配合 UITransform 默认 anchor=0.5,0.5）。
        // 因此这里输出的 cocos.position 采用包围盒中心点坐标，而不是左下角。
        //
        // PSD 坐标：左上角为原点，y 向下
        // Cocos 坐标：y 向上
        const centerPx = left + w / 2;
        const centerPy = top + h / 2;
        const centerYUp = psdHeight - centerPy;

        const y = spec.options.origin === 'center' ? centerYUp - centerY : centerYUp;
        const x = spec.options.origin === 'center' ? centerPx - centerX : centerPx;

        layer.cocos.position.x = Math.round(x * 1000) / 1000;
        layer.cocos.position.y = Math.round(y * 1000) / 1000;
        layer.cocos.size.width = w;
        layer.cocos.size.height = h;
    }
}

function buildMarkdown(spec: UISpec): string {
    const lines: string[] = [];
    lines.push(`# PSD UI Spec（自动生成）`);
    lines.push('');
    lines.push(`- **来源 PSD**：\`${spec.source.psdPath}\``);
    lines.push(`- **画布尺寸**：${spec.psd.width} x ${spec.psd.height}`);
    lines.push(`- **坐标原点策略**：\`${spec.options.origin}\`（见 JSON 内 cocos.position 说明）`);
    lines.push(`- **包含图层像素数据**：\`${spec.options.includeImageData ? '是' : '否'}\``);
    lines.push('');
    if (spec.warnings.length) {
        lines.push(`## ⚠️ 警告`);
        for (const w of spec.warnings) lines.push(`- ${w}`);
        lines.push('');
    }
    lines.push(`## 图层清单（扁平化）`);
    lines.push('');
    lines.push(`| kind | visible | name | path | size | pos(x,y) |`);
    lines.push(`| --- | --- | --- | --- | --- | --- |`);
    for (const l of spec.layers) {
        lines.push(
            `| ${l.kind} | ${l.visible} | ${l.name} | ${l.path} | ${l.cocos.size.width}x${l.cocos.size.height} | (${l.cocos.position.x}, ${l.cocos.position.y}) |`
        );
    }
    lines.push('');
    lines.push(`## 文本图层`);
    lines.push('');
    const texts = spec.layers.filter(l => l.kind === 'text');
    if (!texts.length) {
        lines.push(`- （无）`);
    } else {
        for (const t of texts) {
            lines.push(`- **${t.path}**：${JSON.stringify(t.text?.content ?? '')}`);
        }
    }
    lines.push('');
    return lines.join('\n');
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv);

    const psdAbs = path.resolve(args.inputPsd);
    const buffer = await readFile(psdAbs);

    // Node 环境下 ag-psd 需要 initializeCanvas 来提供 createImageData（否则会报 Canvas not initialized）。
    // 我们只在 --include-image-data 时启用一个最小 shim，避免引入原生 canvas 依赖。
    if (args.includeImageData) {
        initializeCanvas(
            (width: number, height: number) =>
                ({
                    width,
                    height,
                    getContext: () =>
                        ({
                            createImageData: (w: number, h: number) => ({
                                width: w,
                                height: h,
                                data: new Uint8ClampedArray(w * h * 4)
                            }),
                            putImageData: () => {}
                        }) as any
                }) as any,
            (w: number, h: number) =>
                ({
                    width: w,
                    height: h,
                    data: new Uint8ClampedArray(w * h * 4)
                }) as any
        );
    }

    // Node 环境下 ag-psd 默认会走 canvas；必须跳过缩略图/合成图，或在读取像素时开启 useImageData
    const readOptions = args.includeImageData
        ? {
              skipThumbnail: true,
              // 只需要图层像素即可推导贴图/文本颜色；合成图会触发 canvas 路径，Node 下不初始化 canvas 易报错
              skipCompositeImageData: true,
              skipLayerImageData: false,
              useImageData: true
          }
        : {
              skipThumbnail: true,
              skipCompositeImageData: true,
              skipLayerImageData: true,
              useImageData: false
          };

    const psd: Psd = PSD.readPsd(buffer, readOptions);

    const warnings: string[] = [];
    const layers: UISpecLayer[] = [];

    if (!psd.width || !psd.height) {
        warnings.push('PSD 缺少 width/height 字段，可能是文件损坏或读取失败。');
    }

    // ag-psd 将层级挂在 psd.children（旧代码里的 psd.tree 通常不存在）
    if (psd.children && psd.children.length > 0) {
        for (const child of psd.children) {
            walkLayers(child, null, args.origin, args.includeImageData, layers, warnings);
        }
    } else {
        warnings.push('PSD.children 为空：无法遍历图层（文件可能损坏或格式特殊）。');
    }

    const spec: UISpec = {
        version: 1,
        generator: { name: 'TestMcp/tools/psd-parse', version: '1.0.0' },
        source: { psdPath: psdAbs, fileName: path.basename(psdAbs) },
        psd: {
            width: psd.width ?? 0,
            height: psd.height ?? 0,
            channels: psd.channels,
            bitsPerChannel: psd.bitsPerChannel,
            colorMode: psd.colorMode
        },
        options: {
            includeImageData: args.includeImageData,
            origin: args.origin
        },
        layers,
        warnings
    };

    fixCocosPositions(spec, psd.width ?? 0, psd.height ?? 0);

    const baseName = sanitizeFileBaseName(path.basename(psdAbs, path.extname(psdAbs)));
    const defaultOutJson = path.resolve(process.cwd(), '..', 'assets', 'ui-spec', `${baseName}.json`);
    const outJson = args.outJson ? path.resolve(args.outJson) : defaultOutJson;

    await mkdir(path.dirname(outJson), { recursive: true });
    await writeFile(outJson, JSON.stringify(spec, null, 2), 'utf8');

    console.log(`✓ 已写入 UI Spec JSON：${outJson}`);

    if (args.outMd) {
        const outMdPath = outJson.replace(/\.json$/i, '.md');
        await writeFile(outMdPath, buildMarkdown(spec), 'utf8');
        console.log(`✓ 已写入审阅 MD：${outMdPath}`);
    }
}

main().catch(err => {
    console.error('❌ 解析失败:', err?.message || err);
    process.exit(1);
});
