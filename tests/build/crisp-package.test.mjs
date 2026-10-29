import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const project = fileURLToPath(new URL('../../', import.meta.url));

// Build an isolated working tree so rebuild tests cannot modify the user's theme files.
function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), 'crisp package '));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	for (const name of ['scripts', 'Crisp', 'Crisp-Dark', 'README.md', 'README.zh-CN.md', 'LICENSE.txt', 'package.json']) {
		cpSync(join(project, name), join(root, name), { recursive: true });
	}
	return root;
}

// Invoke the public command, exercising its real shell and ZIP implementation.
function build(root) {
	return spawnSync('npm', ['run', 'build'], { cwd: root, encoding: 'utf8' });
}

// Extract the actual archive so assertions cover filenames and uncompressed bytes.
function unpack(root, directory) {
	const target = join(root, directory);
	execFileSync('unzip', ['-q', join(root, 'dist/freshrss-theme-crisp.zip'), '-d', target]);
	return target;
}

test('release contains both complete themes and documentation, excluding development and system files', t => {
	const root = fixture(t);
	const releaseFiles = ['Crisp', 'Crisp-Dark', 'README.md', 'README.zh-CN.md', 'LICENSE.txt']
		.flatMap(name => readdirSync(root, { recursive: true }).filter(path => path === name || path.startsWith(`${name}/`)))
		.filter(path => statSync(join(root, path)).isFile())
		// Existing Finder/Explorer metadata is excluded just like the injected samples below.
		.filter(path => !path.split('/').some(name => ['.DS_Store', 'Thumbs.db', 'desktop.ini', '__MACOSX'].includes(name) || name.startsWith('._')));
	for (const path of ['Crisp/.DS_Store', 'Crisp/._crisp.css', 'Crisp/thumbs/Thumbs.db', 'Crisp/desktop.ini', 'Crisp/__MACOSX/extra', 'node_modules/extra', 'tests/extra', '.git/extra', 'test-results/extra']) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), 'not part of the release');
	}
	writeFileSync(join(root, 'Crisp/local-change.css'), '/* uncommitted working tree content */');
	const result = build(root);
	assert.equal(result.status, 0, result.stderr || result.stdout);
	const extracted = unpack(root, 'extracted');
	assert.deepEqual(readdirSync(extracted).sort(), ['Crisp', 'Crisp-Dark', 'LICENSE.txt', 'README.md', 'README.zh-CN.md']);
	for (const path of [...releaseFiles, 'Crisp/local-change.css']) {
		assert.deepEqual(readFileSync(join(extracted, path)), readFileSync(join(root, path)), path);
	}
	for (const path of ['Crisp/.DS_Store', 'Crisp/._crisp.css', 'Crisp/thumbs/Thumbs.db', 'Crisp/desktop.ini', 'Crisp/__MACOSX']) {
		assert.equal(existsSync(join(extracted, path)), false, path);
	}
});

test('rebuilding removes deleted files and a failed build preserves the last complete archive', t => {
	const root = fixture(t);
	const extra = join(root, 'Crisp/removed.css');
	writeFileSync(extra, 'temporary release content');
	assert.equal(build(root).status, 0);
	assert.ok(existsSync(join(unpack(root, 'first'), 'Crisp/removed.css')));
	rmSync(extra);
	assert.equal(build(root).status, 0);
	assert.equal(existsSync(join(unpack(root, 'second'), 'Crisp/removed.css')), false);
	const archive = join(root, 'dist/freshrss-theme-crisp.zip');
	const previous = readFileSync(archive);
	rmSync(join(root, 'Crisp-Dark'), { recursive: true });
	assert.notEqual(build(root).status, 0, 'missing theme must fail instead of producing a partial release');
	assert.deepEqual(readFileSync(archive), previous);
	assert.deepEqual(readdirSync(join(root, 'dist')), ['freshrss-theme-crisp.zip']);
});
