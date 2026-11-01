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
	test(`${name} article hierarchy remains readable on ordinary, reader, unread and quote surfaces`, () => {
		for (const foreground of ['heading-1', 'heading-2', 'heading-3', 'heading-4', 'heading-5', 'heading-6', 'strong']) {
			for (const background of ['surface', 'bg', 'unread', 'raised']) {
				const ratio = contrast(colours.get(`--crisp-${foreground}`), colours.get(`--crisp-${background}`));
				assert.ok(ratio >= 4.5, `${foreground} on ${background}: ${ratio.toFixed(2)}:1`);
			}
		}
	});

	// Project regression thresholds for state separation, not WCAG conformance ratios.
	test(`${name} hover and selection remain visibly separate from adjacent states`, () => {
		for (const background of ['surface', 'sidebar', 'raised']) {
			const ratio = contrast(colours.get('--crisp-hover'), colours.get(`--crisp-${background}`));
			assert.ok(ratio >= 1.6, `hover against ${background}: ${ratio.toFixed(2)}:1`);
		}
		const ratio = contrast(colours.get('--crisp-selected'), colours.get('--crisp-hover'));
		assert.ok(ratio >= 1.15, `selected against hover: ${ratio.toFixed(2)}:1`);
	});

	// This surface separation is a project regression threshold, not a WCAG requirement.
	test(`${name} unread articles stand apart from read articles`, () => {
		const ratio = contrast(colours.get('--crisp-unread'), colours.get('--crisp-surface'));
		assert.ok(ratio >= 1.3, `unread against read surface: ${ratio.toFixed(2)}:1`);
	});

	test(`${name} text and state accents remain readable on reading and interaction surfaces`, () => {
		for (const background of ['bg', 'surface', 'sidebar', 'raised', 'unread', 'hover', 'selected', 'accent-soft']) {
			for (const foreground of ['text', 'muted', 'accent']) {
				const ratio = contrast(colours.get(`--crisp-${foreground}`), colours.get(`--crisp-${background}`));
				assert.ok(ratio >= 4.5, `${foreground} on ${background}: ${ratio.toFixed(2)}:1`);
			}
		}
	});

	test(`${name} primary actions and semantic messages remain readable`, () => {
		for (const [foreground, background] of [['on-accent', 'primary'], ['on-accent', 'primary-hover'], ['danger', 'danger-bg'], ['warning', 'warning-bg'], ['code', 'raised']]) {
			assert.ok(contrast(colours.get(`--crisp-${foreground}`), colours.get(`--crisp-${background}`)) >= 4.5, `${foreground} on ${background}`);
		}
	});

	test(`${name} ordinary links remain readable on page, article and inset surfaces`, () => {
		for (const foreground of ['link', 'link-hover']) {
			for (const background of ['bg', 'surface', 'sidebar', 'raised', 'accent-soft']) {
				const ratio = contrast(colours.get(`--crisp-${foreground}`), colours.get(`--crisp-${background}`));
				assert.ok(ratio >= 4.5, `${foreground} on ${background}: ${ratio.toFixed(2)}:1`);
			}
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
