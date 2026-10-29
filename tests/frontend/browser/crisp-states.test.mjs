import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { contrast } from '../crisp-colour.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const upstream = process.env.FRESHRSS_ROOT;
assert.ok(upstream, 'Set FRESHRSS_ROOT to a FreshRSS checkout containing p/themes/base-theme.');
const themes = join(resolve(upstream), 'p/themes');
const fixture = readFileSync(new URL('./crisp-state-fixture.html', import.meta.url), 'utf8');
let browser;

before(async () => {
	browser = await chromium.launch({ channel: process.env.CRISP_BROWSER_CHANNEL || 'chrome' });
});
after(async () => { await browser?.close(); });

// Load the same upstream CSS and theme order as FreshRSS, with local icons and no application requests.
async function openFixture(theme, direction) {
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
	page.setDefaultTimeout(5000);
	await page.route('**/*', async route => {
		const url = new URL(route.request().url());
		if (url.hostname === 'crisp.test' && url.pathname === '/') {
			await route.fulfill({ contentType: 'text/html', body: fixture.replace('<html>', `<html dir="${direction}">`) });
		} else if (url.hostname === 'crisp.test' && /^\/themes\/icons\/[\w-]+\.svg$/.test(url.pathname)) {
			await route.fulfill({ contentType: 'image/svg+xml', body: readFileSync(join(themes, 'icons', url.pathname.split('/').pop())) });
		} else await route.abort();
	});
	await page.goto('http://crisp.test/');
	const suffix = direction === 'rtl' ? '.rtl.css' : '.css';
	const palette = theme === 'light' ? `Crisp/light${suffix}` : `Crisp-Dark/dark${suffix}`;
	for (const path of [join(themes, `base-theme/frss${suffix}`), join(root, palette), join(root, `Crisp/crisp${suffix}`), join(root, `Crisp/layout${suffix}`)]) {
		await page.addStyleTag({ content: readFileSync(path, 'utf8') });
	}
	await page.evaluate(() => document.fonts.ready);
	return page;
}

// Read final rendered properties, including opacity and icon tint, rather than matching CSS source.
async function appearance(page, selector) {
	return page.locator(selector).evaluate(element => {
		const style = getComputedStyle(element);
		return Object.fromEntries(['backgroundColor', 'color', 'borderColor', 'opacity', 'outlineColor', 'outlineStyle', 'outlineWidth', 'outlineOffset', 'filter', 'boxShadow', 'transitionDuration'].map(key => [key, style[key]]));
	});
}

// Composite actual ancestor background layers so transparent links are measured on their rendered surface.
async function renderedBackground(page, selector) {
	return page.locator(selector).evaluate(element => {
		const layers = [];
		for (let node = element; node; node = node.parentElement) {
			layers.unshift(getComputedStyle(node).backgroundColor.match(/[\d.]+/g).map(Number));
		}
		const background = layers.reduce((under, [r, g, b, alpha = 1]) => [r, g, b].map((channel, index) => channel * alpha + under[index] * (1 - alpha)), [255, 255, 255]);
		return `rgb(${background.join(', ')})`;
	});
}

// Detect clipping by the viewport as well as scrolling or clipping ancestors.
async function focusClipped(page, selector) {
	return await page.locator(selector).evaluate(element => {
		const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
		const extent = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
		if (rect.left - extent < 0 || rect.right + extent > innerWidth || rect.top - extent < 0 || rect.bottom + extent > innerHeight) return true;
		for (let parent = element.parentElement; parent; parent = parent.parentElement) {
			const parentStyle = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
			if (['hidden', 'clip', 'auto', 'scroll'].includes(parentStyle.overflowX) && (rect.left - extent < bounds.left || rect.right + extent > bounds.right)) return true;
			if (['hidden', 'clip', 'auto', 'scroll'].includes(parentStyle.overflowY) && (rect.top - extent < bounds.top || rect.bottom + extent > bounds.bottom)) return true;
		}
		return false;
	});
}

// Resolve a CSS colour role through the browser to the same format as computed styles.
async function colour(page, role) {
	return page.evaluate(name => {
		const probe = document.createElement('span');
		probe.style.color = `var(--crisp-${name})`;
		document.body.append(probe);
		const value = getComputedStyle(probe).color;
		probe.remove();
		return value;
	}, role);
}

for (const theme of ['light', 'dark']) for (const direction of ['ltr', 'rtl']) {
	const label = `${theme}/${direction}`;

	test(`${label}: read and unread remain distinct and the header has a clear divider`, async () => {
		const page = await openFixture(theme, direction);
		try {
			await page.locator('#article').evaluate(article => article.classList.remove('current', 'favorite'));
			const unread = await renderedBackground(page, '#article .flux_header');
			const title = page.locator('#article .title');
			assert.equal(await title.evaluate(element => getComputedStyle(element).fontWeight), '400');
			await page.locator('#article').evaluate(article => article.classList.remove('not_read'));
			const read = await renderedBackground(page, '#article .flux_header');
			assert.ok(contrast(unread, read) >= 1.3, 'unread fill separates from read fill');
			assert.equal(await title.evaluate(element => getComputedStyle(element).fontWeight), '400');
			assert.equal((await appearance(page, '#article .title')).color, await colour(page, 'muted'));
			await page.locator('#article .flux_header').hover();
			assert.ok(contrast((await appearance(page, '#article .title')).color, await renderedBackground(page, '#article .flux_header')) >= 4.5);
			await page.locator('#article').evaluate(article => article.classList.add('current', 'favorite', 'not_read'));
			assert.equal(await title.evaluate(element => getComputedStyle(element).fontWeight), '400', 'unread keeps the same weight even when current and favorite');
			assert.equal((await appearance(page, '#article .flux_header')).backgroundColor, await colour(page, 'selected'));
			const divider = await page.locator('.header').evaluate(element => {
				const style = getComputedStyle(element);
				return { width: parseFloat(style.borderBottomWidth), color: style.borderBottomColor, style: style.borderBottomStyle };
			});
			assert.ok(divider.width >= 2);
			assert.equal(divider.style, 'solid');
			for (const role of ['surface', 'bg', 'raised', 'unread']) assert.ok(contrast(divider.color, await colour(page, role)) >= 3, `header divider against ${role}`);
		} finally { await page.close(); }
	});

	test(`${label}: rendered hover, selection and press have distinct cues without moving content`, async () => {
		const page = await openFixture(theme, direction);
		try {
			for (const [ordinary, selected] of [['#ordinary', '#selected'], ['#nav-ordinary', '#nav-selected'], ['#feed-ordinary', '#feed-selected']]) {
				const normal = await renderedBackground(page, ordinary);
				const bounds = await page.locator(ordinary).boundingBox();
				await page.locator(ordinary).hover();
				const hover = await renderedBackground(page, ordinary);
				assert.ok(contrast(normal, hover) >= 1.6, `${ordinary} hover separates from its normal background`);
				assert.ok(contrast(hover, await renderedBackground(page, selected)) >= 1.15, `${selected} separates from hover`);
				if (ordinary === '#ordinary') {
					// Apply the actual CSS filter to an opaque pixel, as the monochrome icons do.
					const iconColour = await page.locator('#ordinary .icon').evaluate(icon => {
						const source = document.createElement('canvas');
						source.width = source.height = 1;
						source.getContext('2d').fillRect(0, 0, 1, 1);
						const output = document.createElement('canvas');
						output.width = output.height = 1;
						const context = output.getContext('2d');
						context.filter = getComputedStyle(icon).filter;
						context.drawImage(source, 0, 0);
						return `rgb(${[...context.getImageData(0, 0, 1, 1).data].slice(0, 3).join(', ')})`;
					});
					assert.ok(contrast(iconColour, hover) >= 3, 'filtered hover icon remains visible against its fill');
				}
				assert.deepEqual(await page.locator(ordinary).boundingBox(), bounds, `${ordinary} hover does not move or resize content`);
			}
			const selected = page.locator('#selected');
			await selected.hover();
			const bounds = await selected.boundingBox();
			assert.equal((await appearance(page, '#selected')).boxShadow, 'none');
			await page.mouse.down();
			assert.equal((await appearance(page, '#selected')).boxShadow, `${await colour(page, 'accent-hover')} 0px 0px 0px 2px inset`);
			assert.deepEqual(await selected.boundingBox(), bounds, 'pressing selected controls does not shift their bounds');
			await page.mouse.up();
		} finally { await page.close(); }
	});

	test(`${label}: selected navigation uses one leading marker on desktop and narrow screens`, async () => {
		const page = await openFixture(theme, direction);
		try {
			const offset = direction === 'rtl' ? '-3px' : '3px';
			for (const width of [1440, 390]) {
				await page.setViewportSize({ width, height: 900 });
				const navigation = await page.locator('#nav-selected').boundingBox();
				const navigationItem = await page.locator('#nav-selected-item').boundingBox();
				assert.ok(navigation.x >= navigationItem.x && navigation.x + navigation.width <= navigationItem.x + navigationItem.width,
					`navigation marker stays inside its clipping parent at ${width}px`);
				for (const [selector, stateOwner, duplicate] of [
					['#nav-selected', '#nav-selected-item', '#nav-selected-item'],
					['#folder-title', '#folder-selected', '#folder-selected'],
					['#feed-selected', '#feed-selected', '#feed-selected > a'],
				]) {
					const selected = page.locator(selector);
					const selectedStyle = await appearance(page, selector);
					assert.equal(selectedStyle.boxShadow, `${await colour(page, 'accent')} ${offset} 0px 0px 0px inset`, `${selector} marker faces the reading start at ${width}px`);
					assert.equal((await appearance(page, duplicate)).boxShadow, 'none', `${selector} marker is not duplicated`);
					await selected.hover();
					assert.equal((await appearance(page, selector)).boxShadow, selectedStyle.boxShadow);
					assert.equal((await appearance(page, selector)).backgroundColor, selectedStyle.backgroundColor);
					// Hover may scroll a clipped ancestor; measure the selection change after that scroll.
					const bounds = await selected.boundingBox();
					await page.locator(stateOwner).evaluate(element => element.classList.remove('active'));
					assert.equal((await appearance(page, selector)).boxShadow, 'none', 'marker belongs only to selection');
					assert.deepEqual(await selected.boundingBox(), bounds, 'selection marker does not move or resize content');
					await page.locator(stateOwner).evaluate(element => element.classList.add('active'));
				}
			}
		} finally { await page.close(); }
	});

	test(`${label}: current, favorite and unread keep independent visual cues`, async () => {
		const page = await openFixture(theme, direction);
		try {
			const edge = direction === 'rtl' ? 'borderRightColor' : 'borderLeftColor';
			const accent = await colour(page, 'accent');
			assert.equal(await page.locator('#article').evaluate((element, property) => getComputedStyle(element)[property], edge), accent);
			assert.equal((await appearance(page, '#article > .flux_header')).backgroundColor, await colour(page, 'selected'));
			for (const name of ['starred', 'unread']) {
				const icon = page.locator(`#article img[src$="/${name}.svg"]`);
				assert.ok(await icon.isVisible(), `${name} remains visible`);
			}
			assert.equal((await appearance(page, '#article img[src$="/starred.svg"]')).filter, 'none');
			await page.locator('#article .flux_header').hover();
			assert.equal((await appearance(page, '#article > .flux_header')).backgroundColor, await colour(page, 'selected'));
		} finally { await page.close(); }
	});

	test(`${label}: button selection changes only the border and still allows hover feedback`, async () => {
		const page = await openFixture(theme, direction);
		try {
			const ordinary = await appearance(page, '#ordinary');
			const selected = await appearance(page, '#selected');
			assert.equal(selected.borderColor, await colour(page, 'accent'));
			assert.notEqual(selected.borderColor, ordinary.borderColor);
			assert.deepEqual({ ...selected, borderColor: ordinary.borderColor }, ordinary);
			assert.equal((await appearance(page, '#selected .icon')).filter, (await appearance(page, '#ordinary .icon')).filter);
			await page.locator('#selected').hover();
			assert.equal((await appearance(page, '#selected')).backgroundColor, await colour(page, 'hover'));
			const menuBefore = await appearance(page, '#menu-toggle');
			await page.locator('#menu-toggle').click();
			assert.ok(await page.locator('#menu-action').isVisible());
			await page.mouse.move(0, 0);
			const menuOpen = await appearance(page, '#menu-toggle');
			for (const property of ['backgroundColor', 'color', 'boxShadow']) assert.equal(menuOpen[property], menuBefore[property]);
			assert.equal(menuOpen.borderColor, await colour(page, 'accent'));
			await page.locator('#menu-toggle').hover();
			assert.equal((await appearance(page, '#menu-toggle')).backgroundColor, await colour(page, 'hover'));
			await page.mouse.down();
			assert.equal((await appearance(page, '#menu-toggle')).boxShadow, `${await colour(page, 'accent-hover')} 0px 0px 0px 2px inset`, 'open menu keeps distinct press feedback');
			await page.mouse.up();
			await page.locator('#menu-toggle').evaluate(element => element.classList.add('disabled'));
			const disabled = await appearance(page, '#menu-toggle');
			assert.equal(disabled.backgroundColor, await colour(page, 'raised'));
			assert.equal(disabled.borderColor, await colour(page, 'accent'));
		} finally { await page.close(); }
	});

	test(`${label}: disabled controls suppress feedback without losing selection`, async () => {
		const page = await openFixture(theme, direction);
		try {
			for (const selector of ['#disabled', '#primary-disabled', '#danger-disabled', '#selected-disabled', '#class-disabled']) {
				const beforeHover = await appearance(page, selector);
				await page.locator(selector).hover();
				assert.deepEqual(await appearance(page, selector), beforeHover);
				if (['#selected-disabled', '#class-disabled'].includes(selector)) {
					assert.equal(beforeHover.backgroundColor, await colour(page, 'raised'));
					assert.equal(beforeHover.borderColor, await colour(page, 'accent'));
					assert.equal(beforeHover.boxShadow, 'none');
					assert.equal(beforeHover.opacity, '1', 'selection must not be faded into its parent');
				}
			}
		} finally { await page.close(); }
	});

	test(`${label}: pressing buttons gives immediate feedback and keeps action semantics`, async () => {
		const page = await openFixture(theme, direction);
		try {
			const ordinary = page.locator('#ordinary');
			await ordinary.hover();
			const hover = await appearance(page, '#ordinary');
			await page.mouse.down();
			const pressed = await appearance(page, '#ordinary');
			assert.notEqual(pressed.backgroundColor, hover.backgroundColor);
			await page.mouse.up();
			for (const [selector, foreground, background] of [['#primary', 'on-accent', 'accent-hover'], ['#danger', 'danger', 'danger-bg']]) {
				await page.locator(selector).hover();
				const beforePress = await appearance(page, selector);
				await page.mouse.down();
				const style = await appearance(page, selector);
				assert.equal(style.color, await colour(page, foreground));
				assert.equal(style.backgroundColor, await colour(page, background));
				assert.notEqual(style.boxShadow, beforePress.boxShadow, 'semantic buttons distinguish pressing from hover');
				await page.mouse.up();
			}
		} finally { await page.close(); }
	});

	test(`${label}: keyboard focus overlays selection and fits grouped controls`, async () => {
		const page = await openFixture(theme, direction);
		try {
			await page.locator('#menu-toggle').click();
			await page.keyboard.press('Tab');
			for (const selector of ['#ordinary', '#selected', '#danger', '#search', '#search-button', '#menu-action', '#source']) {
				await page.locator(selector).focus();
				assert.ok(await page.locator(selector).evaluate(element => element.matches(':focus-visible')));
				const style = await appearance(page, selector);
				assert.equal(style.outlineStyle, 'solid');
				assert.ok(parseFloat(style.outlineWidth) >= 2);
				if (selector === '#selected') assert.equal(style.backgroundColor, await colour(page, 'raised'));
				const clipped = await focusClipped(page, selector);
				assert.equal(clipped, false, `${selector} focus is clipped`);
			}
		} finally { await page.close(); }
	});

	test(`${label}: filled sidebar actions keep visible unclipped keyboard focus`, async () => {
		const page = await openFixture(theme, direction);
		try {
			await page.keyboard.press('Tab');
			for (const selector of ['#btn-subscription', '#btn-add']) {
				await page.locator(selector).focus();
				assert.ok(await page.locator(selector).evaluate(element => element.matches(':focus-visible')));
				const style = await appearance(page, selector);
				assert.equal(style.outlineStyle, 'solid');
				assert.ok(parseFloat(style.outlineWidth) >= 2);
				const inside = parseFloat(style.outlineOffset) < 0;
				const background = await renderedBackground(page, inside ? selector : '#fixture-aside .configure-feeds');
				const ratio = contrast(style.outlineColor, background);
				assert.ok(ratio >= 3, `${selector} focus against ${inside ? 'its fill' : 'its surrounding surface'}: ${ratio.toFixed(2)}:1`);
				assert.equal(await focusClipped(page, selector), false, `${selector} focus is clipped`);
			}
		} finally { await page.close(); }
	});

	test(`${label}: rendered text, control edges and focus have sufficient contrast`, async () => {
		const page = await openFixture(theme, direction);
		try {
			for (const selector of ['#ordinary', '#selected', '#primary', '#danger', '#selected-disabled', '#source', '#nav-selected', '#folder-title', '#feed-selected > a']) {
				const style = await appearance(page, selector);
				const background = await renderedBackground(page, selector);
				assert.ok(contrast(style.color, background) >= 4.5, `${selector} text against its rendered background`);
				assert.equal(style.opacity, '1', `${selector} must not invalidate its colour contrast through opacity`);
			}
			await page.keyboard.press('Tab');
			for (const selector of ['#ordinary', '#selected', '#primary', '#danger', '#search']) {
				await page.locator(selector).focus();
				const style = await appearance(page, selector);
				assert.ok(contrast(style.outlineColor, await colour(page, 'bg')) >= 3, `${selector} focus against the surrounding page`);
			}
			for (const selector of ['#ordinary', '#search']) {
				const style = await appearance(page, selector);
				assert.ok(contrast(style.borderColor, style.backgroundColor) >= 3, `${selector} border against its fill`);
			}
		} finally { await page.close(); }
	});

	test(`${label}: reduced motion removes transitions and pressing is immediate`, async () => {
		const page = await openFixture(theme, direction);
		try {
			assert.equal((await appearance(page, '#ordinary')).transitionDuration, '0s');
			await page.emulateMedia({ reducedMotion: 'no-preference' });
			assert.ok((await appearance(page, '#ordinary')).transitionDuration.split(',').some(value => parseFloat(value) > 0));
			await page.locator('#ordinary').hover();
			await page.mouse.down();
			assert.ok((await appearance(page, '#ordinary')).transitionDuration.split(',').every(value => parseFloat(value) <= 0.05), 'pressed feedback should not wait for the hover transition');
			await page.mouse.up();
		} finally { await page.close(); }
	});
}
