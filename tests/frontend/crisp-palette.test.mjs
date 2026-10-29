import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { contrast } from './crisp-colour.mjs';

// Read the standalone palette without depending on a FreshRSS installation.
function palette(path) {
	const source = readFileSync(new URL(path, import.meta.url), 'utf8');
	return new Map([...source.matchAll(/(--crisp-[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

const palettes = ['../../Crisp/light.css', '../../Crisp-Dark/dark.css'].map(palette);

test('both fixed palettes supply every shared colour role', () => {
	assert.deepEqual([...palettes[0].keys()].sort(), [...palettes[1].keys()].sort());
	const source = ['crisp.css', 'layout.css'].map(name => readFileSync(new URL(`../../Crisp/${name}`, import.meta.url), 'utf8')).join('\n');
	for (const [, role] of source.matchAll(/var\((--crisp-[\w-]+)/g)) {
		for (const colours of palettes) assert.ok(colours.has(role), `missing palette role: ${role}`);
	}
});

for (const [index, colours] of palettes.entries()) {
	const name = index === 0 ? 'light' : 'dark';
	test(`${name} text and links remain readable on reading and interaction surfaces`, () => {
		for (const background of ['bg', 'surface', 'sidebar', 'raised', 'unread', 'hover', 'selected']) {
			for (const foreground of ['text', 'muted', 'accent']) {
				const ratio = contrast(colours.get(`--crisp-${foreground}`), colours.get(`--crisp-${background}`));
				assert.ok(ratio >= 4.5, `${foreground} on ${background}: ${ratio.toFixed(2)}:1`);
			}
		}
	});

	test(`${name} primary actions and semantic messages remain readable`, () => {
		for (const [foreground, background] of [['on-accent', 'accent'], ['on-accent', 'accent-hover'], ['danger', 'danger-bg'], ['warning', 'warning-bg'], ['code', 'raised']]) {
			assert.ok(contrast(colours.get(`--crisp-${foreground}`), colours.get(`--crisp-${background}`)) >= 4.5, `${foreground} on ${background}`);
		}
	});
}

for (const [index, colours] of palettes.entries()) {
	const name = index === 0 ? 'light' : 'dark';
	test(`${name} controls and focus remain distinguishable from their surroundings`, () => {
		for (const background of ['bg', 'surface', 'sidebar', 'raised', 'hover']) {
			for (const foreground of ['control-border', 'accent']) {
				const ratio = contrast(colours.get(`--crisp-${foreground}`), colours.get(`--crisp-${background}`));
				assert.ok(ratio >= 3, `${foreground} on ${background}: ${ratio.toFixed(2)}:1`);
			}
		}
	});
}
