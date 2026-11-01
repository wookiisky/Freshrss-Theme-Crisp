import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const upstream = process.env.FRESHRSS_ROOT;
assert.ok(upstream, 'Set FRESHRSS_ROOT to a FreshRSS checkout containing p/themes/base-theme.');
const themes = join(resolve(upstream), 'p/themes');
const fixture = readFileSync(new URL('./crisp-article-fixture.html', import.meta.url), 'utf8');
const script = readFileSync(join(root, 'Crisp/crisp.js'), 'utf8');
let browser;

before(async () => {
	browser = await chromium.launch({ channel: process.env.CRISP_BROWSER_CHANNEL || 'chrome' });
});
after(async () => { await browser?.close(); });

// Load actual FreshRSS CSS before the asynchronous theme entry point executes.
async function openArticle(theme, direction, early = false) {
	const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
	page.setDefaultTimeout(5000);
	const suffix = direction === 'rtl' ? '.rtl.css' : '.css';
	const palette = theme === 'light' ? `Crisp/light${suffix}` : `Crisp-Dark/dark${suffix}`;
	const styles = [join(themes, `base-theme/frss${suffix}`), join(root, palette), join(root, `Crisp/crisp${suffix}`), join(root, `Crisp/layout${suffix}`)]
		.map(path => `<style>${readFileSync(path, 'utf8')}</style>`).join('\n');
	const html = fixture.replace('<html>', `<html dir="${direction}">`)
		.replace('</head>', `${styles}${early ? `<script>${script}</script>` : ''}</head>`);
	await page.route('**/*', async route => {
		if (route.request().url() === 'http://article.test/') await route.fulfill({ contentType: 'text/html', body: html });
		else await route.abort();
	});
	await page.goto('http://article.test/');
	return page;
}

// Inspect rendered spacing without coupling the assertions to implementation class names.
async function blockSpacing(page, selector) {
	return page.locator(selector).evaluate(element => {
		const style = getComputedStyle(element);
		return { before: parseFloat(style.marginBlockStart), after: parseFloat(style.marginBlockEnd), font: parseFloat(style.fontSize) };
	});
}

// Count breaks that still take part in layout, including breaks inside inline wrappers.
async function visibleBreaks(page, selector) {
	return page.locator(selector).evaluate(element => [...element.querySelectorAll('br')].filter(br => br.getClientRects().length > 0).length);
}

// Compare preserved content and computed styles at the real browser boundary.
async function protectedContent(page) {
	return page.locator('[data-protected]').evaluateAll(elements => elements.map(element => {
		const style = getComputedStyle(element);
		return {
			name: element.dataset.protected,
			html: element.outerHTML,
			text: element.textContent,
			display: style.display,
			whiteSpace: style.whiteSpace,
			margin: style.margin,
			padding: style.padding,
			height: element.getBoundingClientRect().height,
		};
	}));
}

for (const theme of ['light', 'dark']) for (const direction of ['ltr', 'rtl']) {
	test(`${theme}/${direction}: article paragraphs and headings use consistent block spacing`, async () => {
		const page = await openArticle(theme, direction);
		try {
			await page.addScriptTag({ content: script });
			for (const selector of ['[data-case="paragraph-first"]', '[data-case="paragraph-second"]']) {
				const spacing = await blockSpacing(page, selector);
				assert.ok(Math.abs(spacing.before - spacing.font * 0.8) < 0.1, `${selector} has 0.8em before`);
				assert.ok(Math.abs(spacing.after - spacing.font * 0.8) < 0.1, `${selector} has 0.8em after`);
			}
			const heading = await blockSpacing(page, '[data-case="heading"]');
			assert.ok(Math.abs(heading.before - heading.font * 1.4) < 0.1);
			assert.ok(Math.abs(heading.after - heading.font * 0.6) < 0.1);
			assert.equal((await blockSpacing(page, '[data-case="header-paragraph"]')).before, 53);
			assert.equal((await blockSpacing(page, '[data-case="footer-paragraph"]')).before, 57);
		} finally { await page.close(); }
	});

	test(`${theme}/${direction}: blank blocks and excess breaks collapse without replacing content`, async () => {
		const page = await openArticle(theme, direction);
		try {
			const originalText = await page.locator('.flux_content .text').textContent();
			await page.evaluate(() => {
				window.originalArticleNodes = [...document.querySelectorAll('.flux_content .text *')];
				const link = document.querySelector('.text a');
				link.addEventListener('click', () => { window.articleLinkClicked = true; });
			});
			await page.addScriptTag({ content: script });
			for (const name of ['blank-empty', 'blank-nbsp', 'blank-breaks', 'blank-nested', 'blank-recoverable']) {
				assert.equal(await page.locator(`[data-case="${name}"]`).isVisible(), false, `${name} has no visible spacer`);
				assert.equal(await page.locator(`[data-case="${name}"]`).count(), 1, 'empty block remains in the DOM');
			}
			for (const [name, count] of [['single-break', 1], ['double-break', 2], ['many-breaks', 2], ['wrapped-breaks', 2], ['boundary-breaks', 2]]) {
				assert.equal(await visibleBreaks(page, `[data-case="${name}"]`), count, name);
			}
			assert.equal(await page.locator('[data-case="word-space"]').innerText(), 'first second');
			assert.equal(await page.locator('.flux_content .text').textContent(), originalText, 'raw article text is unchanged');
			assert.equal(await page.evaluate(() => window.originalArticleNodes.every(node => node.isConnected)), true, 'original nodes retain identity');
			await page.locator('.text a[href="#fixture-anchor"]').click();
			assert.equal(await page.evaluate(() => window.articleLinkClicked), true, 'existing link listener survives');
			assert.equal(new URL(page.url()).hash, '#fixture-anchor', 'anchor target remains available');
			const gap = await page.evaluate(() => {
				const first = document.querySelector('[data-case="paragraph-first"]');
				const second = document.querySelector('[data-case="paragraph-second"]');
				return { pixels: second.getBoundingClientRect().top - first.getBoundingClientRect().bottom, font: parseFloat(getComputedStyle(first).fontSize) };
			});
			assert.ok(Math.abs(gap.pixels - gap.font * 0.8) < 0.2, 'empty blocks do not add to the normal paragraph gap');
			const once = await page.locator('.flux_content .text').innerHTML();
			await page.locator('.flux').evaluate(article => article.dispatchEvent(new Event('freshrss:openArticle', { bubbles: true })));
			await page.evaluate(() => document.body.dispatchEvent(new Event('freshrss:load-more', { bubbles: true })));
			assert.equal(await page.locator('.flux_content .text').innerHTML(), once, 'repeated normalisation is idempotent');
		} finally { await page.close(); }
	});

	test(`${theme}/${direction}: code, preformatted text, media, anchors and decorations retain their layout`, async () => {
		const page = await openArticle(theme, direction);
		try {
			const before = await protectedContent(page);
			const outside = await page.locator('[data-case="outside-article"]').evaluate(element => ({ html: element.outerHTML, height: element.getBoundingClientRect().height }));
			await page.addScriptTag({ content: script });
			assert.deepEqual(await protectedContent(page), before);
			assert.deepEqual(await page.locator('[data-case="outside-article"]').evaluate(element => ({ html: element.outerHTML, height: element.getBoundingClientRect().height })), outside);
			assert.ok(await page.locator('[data-protected="image-wrapper"]').isVisible(), 'lazy image wrapper stays visible before a source is available');
			await page.locator('[data-case="lazy-image"]').scrollIntoViewIfNeeded();
			await page.locator('[data-case="lazy-image"]').evaluate(image => {
				image.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="gray"/></svg>';
			});
			await page.waitForFunction(() => document.querySelector('[data-case="lazy-image"]').complete);
			assert.ok(await page.locator('[data-case="lazy-image"]').isVisible(), 'lazy image can still become visible');
		} finally { await page.close(); }
	});
}

test('article processing supports early scripts, opening replaced content and loading more articles', async () => {
	const page = await openArticle('light', 'ltr', true);
	try {
		assert.equal(await page.locator('[data-case="blank-nbsp"]').isVisible(), false, 'DOMContentLoaded handles early theme scripts');
		await page.locator('[data-case="blank-recoverable"]').evaluate(element => { element.textContent = 'Newly available content'; });
		await page.locator('.flux').evaluate(article => article.dispatchEvent(new Event('freshrss:openArticle', { bubbles: true })));
		assert.ok(await page.locator('[data-case="blank-recoverable"]').isVisible(), 'a previously empty block can recover');
		await page.locator('.flux_content .text').evaluate(body => {
			window.originalTextNode = body;
			body.innerHTML = '<p data-case="replacement" style="margin: 90px 0">New<br><br><br><br>content</p><p data-case="replacement-empty">&nbsp;</p>';
		});
		await page.locator('.flux').evaluate(article => article.dispatchEvent(new Event('freshrss:openArticle', { bubbles: true })));
		assert.equal(await page.locator('.flux_content .text').evaluate(body => body === window.originalTextNode), true);
		assert.equal(await visibleBreaks(page, '[data-case="replacement"]'), 2);
		assert.equal(await page.locator('[data-case="replacement-empty"]').isVisible(), false);
		const replacement = await blockSpacing(page, '[data-case="replacement"]');
		assert.ok(Math.abs(replacement.before - replacement.font * 0.8) < 0.1);
		await page.locator('#stream').evaluate(stream => stream.insertAdjacentHTML('beforeend', '<article class="flux"><div class="flux_content"><div class="content"><div class="text"><p data-case="appended">Appended<br><br><br><br>content</p><div data-case="appended-empty"><p><br></p></div></div></div></div></article>'));
		await page.evaluate(() => document.body.dispatchEvent(new Event('freshrss:load-more', { bubbles: true })));
		assert.equal(await visibleBreaks(page, '[data-case="appended"]'), 2);
		assert.equal(await page.locator('[data-case="appended-empty"]').isVisible(), false);
	} finally { await page.close(); }
});

test('decorated article roots and nonempty anchor paragraphs still normalise their contents', async () => {
	const page = await openArticle('light', 'ltr');
	try {
		await page.locator('.flux_content .text').evaluate(body => {
			body.id = 'fixture-article-body';
			body.style.backgroundColor = 'rgb(241, 242, 243)';
			body.insertAdjacentHTML('beforeend', '<p id="fixture-text-anchor" data-case="anchored-paragraph" style="margin: 70px 0">Anchor text<br><br><br><br>continues</p>');
		});
		await page.addScriptTag({ content: script });
		assert.equal(await page.locator('[data-case="blank-nbsp"]').isVisible(), false, 'decorated root does not protect its entire article from processing');
		const ordinary = await blockSpacing(page, '[data-case="paragraph-first"]');
		assert.ok(Math.abs(ordinary.before - ordinary.font * 0.8) < 0.1);
		assert.equal(await page.locator('#fixture-article-body').evaluate(body => body.style.backgroundColor), 'rgb(241, 242, 243)', 'root decoration remains intact');
		assert.equal(await visibleBreaks(page, '[data-case="anchored-paragraph"]'), 2, 'nonempty paragraph anchors do not disable excess-break compression');
		assert.equal(await page.locator('#fixture-text-anchor').count(), 1, 'text anchor remains addressable');
		assert.ok(await page.locator('[data-protected="own-anchor"]').isVisible(), 'empty anchor block is still retained');
		assert.ok(await page.locator('#fixture-anchor').count(), 'nested empty anchor is still present');
	} finally { await page.close(); }
});

test('article spacing remains readable on a narrow viewport and with zoomed text', async () => {
	const page = await openArticle('dark', 'ltr');
	try {
		await page.addScriptTag({ content: script });
		await page.setViewportSize({ width: 390, height: 844 });
		for (const zoom of [1, 2]) {
			await page.evaluate(value => { document.body.style.zoom = value; }, zoom);
			const result = await page.locator('[data-case="many-breaks"]').evaluate(element => {
				const rect = element.getBoundingClientRect();
				return { width: rect.width, height: rect.height, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight };
			});
			assert.ok(result.width > 0 && result.height > 0);
			assert.ok(result.scrollHeight <= result.clientHeight + 1, 'text is not vertically clipped');
			assert.equal(await visibleBreaks(page, '[data-case="many-breaks"]'), 2);
			const spacing = await blockSpacing(page, '[data-case="paragraph-first"]');
			assert.ok(Math.abs(spacing.before - spacing.font * 0.8) < 0.1);
		}
	} finally { await page.close(); }
});
