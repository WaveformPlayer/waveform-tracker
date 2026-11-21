// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

/**
 * Guards the packaging contract: the manifest's entry points, the build
 * scripts that produce them, and that the ES module bundle loads through
 * `require()` (Node 22.12+ loads ES modules that way; 2.0 ships no CommonJS
 * build). The behaviour tests import `src/`, so a broken entry point only
 * surfaces once someone installs the tarball.
 *
 * Runs in node rather than jsdom: esbuild's CLI and `require()` are Node
 * APIs, and the bundle must load without a DOM.
 */

// vitest sets the cwd to the package root.
const root = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

/** @param {string} script - An esbuild command line. */
const outfileOf = (script) => script.match(/--outfile=(\S+)/)?.[1];

/**
 * Run a build script with its output redirected to `outfile`, so the test
 * checks the real build without touching dist/.
 * @param {string} name - The npm script.
 * @param {string} outfile
 */
const buildTo = (name, outfile) => {
	const script = pkg.scripts[name]
		.replace(/^esbuild\b/, resolve(root, 'node_modules/.bin/esbuild'))
		.replace(/--outfile=\S+/, `--outfile=${outfile}`);
	execSync(script, { cwd: root, stdio: 'pipe' });
	return readFileSync(outfile, 'utf8');
};

describe('package manifest', () => {
	it('reads the manifest it means to assert against', () => {
		expect(pkg.name).toBe('@arraypress/waveform-tracker');
	});

	it('marks the package as ESM so Node loads the .esm.js entry without guessing', () => {
		expect(pkg.type).toBe('module');
	});

	it('points main and every condition at the ESM build; no CommonJS build or module field', () => {
		expect(pkg.main).toBe('dist/waveform-tracker.esm.js');
		expect(pkg.module).toBeUndefined();
		expect(pkg.exports['.']).toEqual({
			types: './types/index.d.ts',
			import: './dist/waveform-tracker.esm.js',
			default: './dist/waveform-tracker.esm.js',
		});
		expect(pkg.scripts['build:cjs']).toBeUndefined();
		expect(Object.values(pkg.scripts).join(' ')).not.toContain('--format=cjs');
		expect(existsSync(resolve(root, 'dist/waveform-tracker.cjs'))).toBe(false);
		// require() of an ES module needs Node 22.12+.
		expect(pkg.engines.node).toBe('>=22.12');
	});

	it('keeps ./dist/* and ./package.json reachable, and no raw-source import path', () => {
		expect(pkg.exports['./dist/*']).toBe('./dist/*');
		expect(pkg.exports['./package.json']).toBe('./package.json');
		// 2.0 removed `./src/*`: src/ ships only so declaration maps can open it.
		expect(pkg.exports['./src/*']).toBeUndefined();
		expect(Object.keys(pkg.exports).filter((k) => k.startsWith('./src'))).toEqual([]);
	});

	it('builds every file the manifest names', () => {
		expect(outfileOf(pkg.scripts['build:esm'])).toBe(pkg.main);
		expect(outfileOf(pkg.scripts['build:min'])).toBe(pkg.unpkg);
		expect(outfileOf(pkg.scripts['build:iife'])).toBe('dist/waveform-tracker.js');
	});

	it('marks every bundle (and the source entry) as having side effects', () => {
		// Each one assigns window.WaveformTracker on load.
		for (const name of ['build:esm', 'build:iife', 'build:min']) {
			expect(pkg.sideEffects).toContain(`./${outfileOf(pkg.scripts[name])}`);
		}
		expect(pkg.sideEffects).toContain('./src/index.ts');
	});

	it('bundles with the strict tsconfig.json; there is no separate esbuild tsconfig', () => {
		expect(existsSync(resolve(root, 'tsconfig.esbuild.json'))).toBe(false);
		expect(Object.values(pkg.scripts).join(' ')).not.toContain('--tsconfig');
	});

	it('ships the declarations generated from src, with maps back to it', () => {
		// Written by npm run build:types (tsc -p tsconfig.build.json).
		expect(pkg.scripts.build).toContain('build:types');
		expect(pkg.files).toContain('types/');
		expect(pkg.types).toBe('./types/index.d.ts');
		// `types` must come first in the condition list to be picked.
		expect(Object.keys(pkg.exports['.'])[0]).toBe('types');
		expect(existsSync(resolve(root, 'types/index.d.ts'))).toBe(true);
		// src/ ships only together with declaration maps pointing into it.
		const build = JSON.parse(readFileSync(resolve(root, 'tsconfig.build.json'), 'utf8'));
		expect(build.compilerOptions.declarationMap).toBe(true);
		expect(pkg.files).toContain('src/');
		expect(existsSync(resolve(root, 'types/index.d.ts.map'))).toBe(true);
	});

	it('tests and rebuilds before publishing, so a stale dist cannot ship', () => {
		expect(pkg.scripts.prepublishOnly).toBe('npm test && npm run build');
	});
});

describe('built bundles', () => {
	it('the ES module build gives require() the tracker singleton as default', () => {
		const dir = mkdtempSync(join(tmpdir(), 'waveform-tracker-'));
		try {
			// .mjs, so require() treats it as ESM whatever the scratch dir is.
			const outfile = join(dir, 'waveform-tracker.mjs');
			buildTo('build:esm', outfile);
			const mod = createRequire(import.meta.url)(outfile);
			expect(typeof mod.default.init).toBe('function');
			expect(typeof mod.default.trackPlayer).toBe('function');
			expect(mod.default.getTrackedCount()).toBe(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('the script-tag builds run in strict mode', () => {
		const dir = mkdtempSync(join(tmpdir(), 'waveform-tracker-'));
		try {
			for (const name of ['build:iife', 'build:min']) {
				const code = buildTo(name, join(dir, `${name.replace(':', '-')}.js`));
				expect(code.trimStart().startsWith('"use strict";')).toBe(true);
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
