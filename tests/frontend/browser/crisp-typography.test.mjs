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
const fixture = readFileSync(new URL('./crisp-typography-fixture.html', import.meta.url), 'utf8');
let browser;

before(async () => { browser = await chromium.launch({ channel: process.env.CRISP_BROWSER_CHANNEL || 'chrome' }); });
after(async () => { await browser?.close(); });

// Load typography in the real FreshRSS stylesheet order, including its RTL base.
async function openTypography(theme, direction) {
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
	const suffix = direction === 'rtl' ? '.rtl.css' : '.css';
	const palette = theme === 'light' ? 'Crisp/light' : 'Crisp-Dark/dark';
	const paths = [join(resolve(upstream), `p/themes/base-theme/frss${suffix}`), join(root, `${palette}${suffix}`), join(root, `Crisp/crisp${suffix}`), join(root, `Crisp/layout${suffix}`)];
	const styles = paths.map(path => `<style>${readFileSync(path, 'utf8')}</style>`).join('\n');
	await page.route('**/*', async route => {
		if (route.request().url() === 'http://typography.test/') await route.fulfill({ contentType: 'text/html', body: fixture.replace('<html lang="zh-CN">', `<html lang="zh-CN" dir="${direction}">`).replace('</head>', `${styles}</head>`) });
		else await route.abort();
	});
	await page.goto('http://typography.test/');
	return page;
}

// Read the rendered colour and composite ancestor backgrounds for contrast checks.
async function appearance(page, selector) {
	return page.locator(selector).evaluate(element => {
		const style = getComputedStyle(element), layers = [];
		for (let node = element; node; node = node.parentElement) layers.unshift(getComputedStyle(node).backgroundColor.match(/[\d.]+/g).map(Number));
		const background = layers.reduce((under, [r, g, b, alpha = 1]) => [r, g, b].map((channel, index) => channel * alpha + under[index] * (1 - alpha)), [255, 255, 255]);
		return { color: style.color, background: `rgb(${background.join(', ')})`, weight: parseFloat(style.fontWeight), italic: style.fontStyle, decoration: style.textDecorationLine };
	});
}

for (const theme of ['light', 'dark']) for (const direction of ['ltr', 'rtl']) {
	test(`${theme}/${direction}: article links stay readable when unread and current states overlap`, async () => {
		const page = await openTypography(theme, direction);
		try {
			let ordinary;
			for (const classes of ['flux current', 'flux not_read', 'flux current not_read']) {
				await page.locator('.flux').evaluate((article, value) => { article.className = value; }, classes);
				await page.mouse.move(0, 0);
				const normal = await appearance(page, '[data-case="link"]');
				if (!ordinary) ordinary = normal.color;
				if (classes === 'flux current not_read') assert.equal(normal.color, ordinary, 'the current article uses the ordinary reading surface');
				assert.ok(contrast(normal.color, normal.background) >= 4.5, `${classes} link is readable`);
				await page.locator('[data-case="link"]').hover();
				const hover = await appearance(page, '[data-case="link"]');
				assert.ok(contrast(hover.color, hover.background) >= 4.5, `${classes} hovered link is readable`);
				assert.notEqual(hover.color, normal.color, 'hover keeps visible colour feedback');
				assert.equal((await appearance(page, '[data-case="link"] strong')).color, hover.color);
			}
		} finally { await page.close(); }
	});

	test(`${theme}/${direction}: article highlights are subdued and readable without affecting source colours`, async () => {
		const page = await openTypography(theme, direction);
		try {
			const highlight = await appearance(page, '[data-case="mark"]');
			const channels = highlight.background.match(/[\d.]+/g).map(Number);
			assert.ok(Math.max(...channels) - Math.min(...channels) <= 50, 'highlight background has restrained chroma');
			assert.ok(contrast(highlight.color, highlight.background) >= 4.5, 'highlight text remains readable');
			assert.equal((await appearance(page, '[data-case="mark"] strong')).color, highlight.color);
			await page.locator('footer p').evaluate(element => element.insertAdjacentHTML('beforeend', '<mark data-case="outside-mark">Outside article text</mark>'));
			assert.equal((await appearance(page, '[data-case="outside-mark"]')).background, 'rgb(255, 255, 0)', 'highlights outside the article retain the browser default');
			await page.locator('[data-case="mark"]').evaluate(element => { element.style.cssText = 'color: #ffffff; background-color: #334455'; });
			const source = await appearance(page, '[data-case="mark"]');
			assert.equal(source.color, 'rgb(255, 255, 255)');
			assert.equal(source.background, 'rgb(51, 68, 85)', 'source inline highlight colours remain intact');
		} finally { await page.close(); }
	});

	test(`${theme}/${direction}: article heading levels and bold text have distinct readable colours`, async () => {
		const page = await openTypography(theme, direction);
		try {
			const headings = await Promise.all([1, 2, 3, 4, 5, 6].map(level => appearance(page, `[data-level="${level}"]`)));
			assert.equal(new Set(headings.map(style => style.color)).size, 6, 'each heading level has its own colour');
			const body = await appearance(page, '[data-case="body"]'), strong = await appearance(page, '[data-case="strong"]');
			assert.ok(!headings.some(style => style.color === body.color));
			assert.notEqual(strong.color, body.color);
			assert.ok(strong.weight > body.weight, 'colour supplements bold weight');
			assert.equal((await appearance(page, '[data-case="bold"]')).color, strong.color);
			for (const mode of ['ordinary', 'reader', 'unread']) {
				await page.evaluate(mode => {
					document.querySelector('#stream').classList.toggle('reader', mode === 'reader');
					document.querySelector('.flux').className = mode === 'unread' ? 'flux not_read' : 'flux current';
				}, mode);
				for (const selector of ['[data-level]', '[data-case="strong"]', '[data-case="quote-strong"]']) {
					for (const element of await page.locator(selector).all()) {
						const id = await element.getAttribute(selector === '[data-level]' ? 'data-level' : 'data-case');
						const style = await appearance(page, selector === '[data-level]' ? `[data-level="${id}"]` : selector);
						assert.ok(contrast(style.color, style.background) >= 4.5, `${mode} ${id} has readable contrast`);
					}
				}
			}
		} finally { await page.close(); }
	});

	test(`${theme}/${direction}: emphasis respects headings, links, code, highlights and source colours`, async () => {
		const page = await openTypography(theme, direction);
		try {
			for (const selector of ['[data-level="1"]', '[data-case="link"]', '[data-case="mark"]', '[data-case="pre"] code', '[data-case="code-nested"]', '[data-case="kbd"]']) {
				const child = selector === '[data-case="kbd"]' ? 'b' : 'strong';
				assert.equal((await appearance(page, `${selector} ${child}`)).color, (await appearance(page, selector)).color, `${selector} retains its context colour`);
			}
			for (const selector of ['[data-case="em"]', '[data-case="italic"]']) {
				const style = await appearance(page, selector);
				assert.equal(style.color, (await appearance(page, '[data-case="body"]')).color);
				assert.equal(style.italic, 'italic');
			}
			assert.equal((await appearance(page, '[data-level="2"] em')).color, (await appearance(page, '[data-level="2"]')).color);
			assert.equal((await appearance(page, '[data-case="strong-em"]')).color, (await appearance(page, '[data-case="strong"]')).color);
			assert.equal((await appearance(page, '[data-case="inline-color"]')).color, 'rgb(181, 50, 62)');
			assert.equal((await appearance(page, '[data-case="syntax"]')).color, 'rgb(197, 120, 54)');
			assert.equal((await appearance(page, '[data-case="outside"]')).color, (await appearance(page, 'footer p')).color);
			assert.equal((await appearance(page, '[data-case="link"]')).decoration, 'underline');
			await page.locator('[data-case="link"]').hover();
			assert.equal((await appearance(page, '[data-case="link"] strong')).color, (await appearance(page, '[data-case="link"]')).color);
			await page.locator('[data-case="link"]').focus();
			assert.equal(await page.locator('[data-case="link"]').evaluate(element => getComputedStyle(element).outlineStyle), 'solid');
		} finally { await page.close(); }
	});

	test(`${theme}/${direction}: typography wraps on phones with enlarged text`, async () => {
		const page = await openTypography(theme, direction);
		try {
			await page.addScriptTag({ content: readFileSync(join(root, 'Crisp/crisp.js'), 'utf8') });
			await page.setViewportSize({ width: 390, height: 844 });
			for (const size of ['100%', '200%']) {
				await page.evaluate(value => { document.documentElement.style.fontSize = value; }, size);
				const dimensions = await page.locator('.text').evaluate(element => ({ scroll: element.scrollWidth, width: element.clientWidth }));
				assert.ok(dimensions.scroll <= dimensions.width + 1, 'reading column has no horizontal overflow');
				for (const element of await page.locator('[data-level]').all()) {
					assert.equal(await element.evaluate(node => node.scrollHeight <= node.clientHeight + 1), true, 'heading is not clipped');
				}
			}
		} finally { await page.close(); }
	});
}
