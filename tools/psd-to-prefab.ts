/**
 * 一键：PSD → ui-spec JSON →（经 MCP）Prefab
 *
 * 用法（二选一）：
 *   npx tsx psd-to-prefab.ts <PSD路径> <贴图资源文件夹路径>
 *   npx tsx psd-to-prefab.ts --psd <PSD路径> --texture-dir <贴图资源文件夹路径>
 *
 * 可选：
 *   --out-json <路径>     默认：项目 assets/ui-spec/<PSD主文件名>.json
 *   --prefab <db路径>     默认：db://assets/prefabs/<主文件名>_fromPsd.prefab
 *   --rules <规则.json>   传给 ui-spec-to-prefab（缺省则按 spec 同名 .rules.json）
 *   --origin center|topleft  默认 center
 *   --no-md               不生成同名 .md（默认会生成 .md）
 *   --include-image-data  传给 psd-parse（文字颜色等更准，但更慢）
 *
 * 前置：Cocos Creator 已打开本项目，cocos-mcp-server 已启动（默认 COCOS_MCP_URL=http://127.0.0.1:8585/mcp）
 */

import { spawnSync } from 'child_process';
import { mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(toolsDir, '..');

type Cli = {
    psd: string;
    textureDir: string;
    outJson?: string;
    prefabDb?: string;
    rules?: string;
    origin: 'center' | 'topleft';
    md: boolean;
    includeImageData: boolean;
};

function printUsage(code = 1): never {
    console.log(`用法:
  npm run psd:prefab -- <PSD路径> <贴图资源文件夹路径>
  npm run psd:prefab -- --psd <PSD路径> --texture-dir <贴图资源文件夹路径>

可选: --out-json <路径>  --prefab <db://...>  --rules <json>
      --origin center|topleft  --no-md  --include-image-data
`);
    process.exit(code);
}

function safeBaseName(psdPath: string): string {
    const base = path.basename(psdPath, path.extname(psdPath));
    const s = base.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').trim();
    return s || 'Untitled';
}

function parseCli(argv: string[]): Cli {
    const pos: string[] = [];
    const kv = new Map<string, string>();
    const flags = new Set<string>();

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--help' || a === '-h') printUsage(0);
        if (
            a === '--psd' ||
            a === '--texture-dir' ||
            a === '--out-json' ||
            a === '--prefab' ||
            a === '--rules' ||
            a === '--origin'
        ) {
            const v = argv[i + 1];
            if (!v || v.startsWith('--')) printUsage(1);
            kv.set(a, v);
            i++;
            continue;
        }
        if (a.startsWith('--')) {
            flags.add(a);
            continue;
        }
        pos.push(a);
    }

    let psd = kv.get('--psd');
    let textureDir = kv.get('--texture-dir');
    if (!psd && pos[0]) psd = pos[0];
    if (!textureDir && pos[1]) textureDir = pos[1];
    if (!psd || !textureDir) printUsage(1);

    const originRaw = kv.get('--origin') ?? 'center';
    if (originRaw !== 'center' && originRaw !== 'topleft') printUsage(1);

    const md = !flags.has('--no-md');

    return {
        psd: path.resolve(psd),
        textureDir: path.resolve(textureDir),
        outJson: kv.get('--out-json'),
        prefabDb: kv.get('--prefab'),
        rules: kv.get('--rules'),
        origin: originRaw,
        md,
        includeImageData: flags.has('--include-image-data')
    };
}

function runStep(name: string, args: string[]): void {
    const r = spawnSync('npm', ['run', name, '--', ...args], {
        cwd: toolsDir,
        stdio: 'inherit',
        shell: true,
        env: process.env
    });
    if (r.status !== 0) {
        console.error(`\n步骤失败: npm run ${name}（退出码 ${r.status ?? 'unknown'}）`);
        process.exit(r.status ?? 1);
    }
}

async function main(): Promise<void> {
    const cli = parseCli(process.argv.slice(2));
    const base = safeBaseName(cli.psd);

    const outJson = cli.outJson ?? path.join(projectRoot, 'assets', 'ui-spec', `${base}.json`);
    const prefabDb =
        cli.prefabDb ?? `db://assets/prefabs/${base}_fromPsd.prefab`;

    await mkdir(path.dirname(outJson), { recursive: true });

    console.log('=== 1/2 PSD → UI Spec JSON ===');
    console.log(`  PSD: ${cli.psd}`);
    console.log(`  输出: ${outJson}`);
    const parseArgs = [cli.psd, '--out', outJson, '--origin', cli.origin];
    if (cli.md) parseArgs.push('--md');
    if (cli.includeImageData) parseArgs.push('--include-image-data');
    runStep('psd:parse', parseArgs);

    console.log('\n=== 2/2 UI Spec → Prefab（MCP）===');
    console.log(`  Spec: ${outJson}`);
    console.log(`  贴图目录: ${cli.textureDir}`);
    console.log(`  Prefab: ${prefabDb}`);
    const prefabArgs = [outJson, '--texture-dir', cli.textureDir, '--prefab', prefabDb];
    if (cli.rules) prefabArgs.push('--rules', cli.rules);
    runStep('ui-spec:prefab', prefabArgs);

    console.log('\n✅ 全流程结束。');
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
