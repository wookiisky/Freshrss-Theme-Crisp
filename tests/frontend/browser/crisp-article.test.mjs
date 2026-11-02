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
			lineHeight: style.lineHeight,
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
				assert.ok(Math.abs(spacing.before - (selector.includes('paragraph-first') ? 0 : spacing.font * 0.54)) < 0.1, `${selector} keeps only its inward paragraph spacing`);
				assert.ok(Math.abs(spacing.after - spacing.font * 0.54) < 0.1, `${selector} has 0.54em after`);
			}
			const lineHeight = await page.locator('[data-case="paragraph-first"]').evaluate(element => {
				const style = getComputedStyle(element);
				return parseFloat(style.lineHeight) / parseFloat(style.fontSize);
			});
			assert.ok(Math.abs(lineHeight - 1.395) < 0.001, 'ordinary paragraphs use compact line height');
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
			for (const [name, count] of [['single-break', 1], ['double-break', 1], ['many-breaks', 1], ['wrapped-breaks', 1], ['boundary-breaks', 0], ['wrapped-boundary-breaks', 0]]) {
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
			assert.ok(Math.abs(gap.pixels - gap.font * 0.54) < 0.2, 'empty blocks do not add to the normal paragraph gap');
			const once = await page.locator('.flux_content .text').innerHTML();
			await page.locator('.flux').evaluate(article => article.dispatchEvent(new Event('freshrss:openArticle', { bubbles: true })));
			await page.evaluate(() => document.body.dispatchEvent(new Event('freshrss:load-more', { bubbles: true })));
			assert.equal(await page.locator('.flux_content .text').innerHTML(), once, 'repeated normalisation is idempotent');
		} finally { await page.close(); }
	});

	test(`${theme}/${direction}: article and wrapped paragraph edges have no empty lines or outer spacing`, async () => {
		const page = await openArticle(theme, direction);
		try {
			await page.locator('.flux_content .text').evaluate(body => {
				body.innerHTML = '<br><span><br></span><div><p>&nbsp;<br></p><section><p data-case="edge-first"><span><br> &nbsp;</span>First<span><br><br></span></p><br><div><br><p data-case="edge-middle">Middle<br><br>continues</p><br></div><p data-case="edge-last"><br><span>Last</span><br></p></section><p><br></p></div><span><br></span><br>';
			});
			const original = await page.locator('.flux_content .text').textContent();
			await page.addScriptTag({ content: script });
			assert.equal(await visibleBreaks(page, '.flux_content .text'), 1, 'only the middle paragraph line break remains');
			const first = await blockSpacing(page, '[data-case="edge-first"]');
			const middle = await blockSpacing(page, '[data-case="edge-middle"]');
			const last = await blockSpacing(page, '[data-case="edge-last"]');
			assert.equal(first.before, 0);
			assert.ok(Math.abs(first.after - first.font * 0.54) < 0.1);
			assert.ok(Math.abs(middle.before - middle.font * 0.54) < 0.1);
			assert.ok(Math.abs(middle.after - middle.font * 0.54) < 0.1);
			assert.equal(last.after, 0);
			assert.ok(Math.abs(last.before - last.font * 0.54) < 0.1);
			assert.equal(await page.locator('.flux_content .text').textContent(), original, 'normalisation preserves source text');
			for (const width of [1200, 390]) {
				await page.setViewportSize({ width, height: 900 });
				const padding = await page.locator('.flux_content .text').evaluate(element => {
					const style = getComputedStyle(element);
					return [style.paddingBlockStart, style.paddingBlockEnd];
				});
				assert.deepEqual(padding, ['0px', '0px'], 'article padding does not add leading or trailing blank space');
			}
		} finally { await page.close(); }
	});

	test(`${theme}/${direction}: code, preformatted text, media, anchors and decorations retain their layout`, async () => {
		const page = await openArticle(theme, direction);
		try {
			for (const name of ['inline-code', 'table', 'pre-wrap', 'nested-pre-wrap']) {
				const ratio = await page.locator(`[data-protected="${name}"]`).evaluate(element => {
					const style = getComputedStyle(element);
					return parseFloat(style.lineHeight) / parseFloat(style.fontSize);
				});
				assert.ok(Math.abs(ratio - 1.7) < 0.001, `${name} retains the original line height`);
			}
			const before = await protectedContent(page);
			const outside = await page.locator('[data-case="outside-article"]').evaluate(element => ({ html: element.outerHTML, height: element.getBoundingClientRect().height }));
			await page.addScriptTag({ content: script });
			assert.deepEqual(await protectedContent(page), before);
			for (const selector of ['[data-case="code-wrapper"]', '[data-case="nested-pre-wrapper"]']) {
				const ratio = await page.locator(selector).evaluate(element => {
					const style = getComputedStyle(element);
					return parseFloat(style.lineHeight) / parseFloat(style.fontSize);
				});
				assert.ok(Math.abs(ratio - 1.7) < 0.001, 'paragraphs containing protected text retain their line height');
			}
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
		assert.equal(await visibleBreaks(page, '[data-case="replacement"]'), 1);
		assert.equal(await page.locator('[data-case="replacement-empty"]').isVisible(), false);
		const replacement = await blockSpacing(page, '[data-case="replacement"]');
		assert.equal(replacement.before, 0);
		assert.equal(replacement.after, 0);
		await page.locator('#stream').evaluate(stream => stream.insertAdjacentHTML('beforeend', '<article class="flux"><div class="flux_content"><div class="content"><div class="text"><p data-case="appended">Appended<br><br><br><br>content</p><div data-case="appended-empty"><p><br></p></div></div></div></div></article>'));
		await page.evaluate(() => document.body.dispatchEvent(new Event('freshrss:load-more', { bubbles: true })));
		assert.equal(await visibleBreaks(page, '[data-case="appended"]'), 1);
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
		assert.equal(ordinary.before, 0);
		assert.equal(await page.locator('#fixture-article-body').evaluate(body => body.style.backgroundColor), 'rgb(241, 242, 243)', 'root decoration remains intact');
		assert.equal(await visibleBreaks(page, '[data-case="anchored-paragraph"]'), 1, 'nonempty paragraph anchors do not disable excess-break compression');
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
			assert.equal(await visibleBreaks(page, '[data-case="many-breaks"]'), 1);
			const spacing = await blockSpacing(page, '[data-case="paragraph-first"]');
			assert.equal(spacing.before, 0);
		}
	} finally { await page.close(); }
});


test('edge trimming retains media, anchors and protected inline content', async () => {
	const page = await openArticle('light', 'ltr');
	try {
		await page.locator('.flux_content .text').evaluate(body => {
			body.innerHTML = '<p data-case="media-edge"><br><span><img data-protected="edge-image" width="80" height="40" alt="Media"></span><br></p><p data-case="anchor-edge"><br><a id="edge-anchor" data-protected="edge-anchor"></a><br></p><p data-case="inline-protected">Text<br><br><code data-protected="edge-code">one<br><br><br>two</code><br><br>Tail</p><p data-case="link-edge"><br><a href="#edge-anchor" data-case="edge-link">Link<br><br>label</a><br></p>';
		});
		const protectedBefore = await protectedContent(page);
		const linkBefore = await page.locator('[data-case="edge-link"]').innerHTML();
		await page.addScriptTag({ content: script });
		const protectedAfter = await protectedContent(page);
		// Empty navigation targets need their identity, not the line box removed with outer breaks.
		for (const snapshot of [protectedBefore, protectedAfter]) {
			delete snapshot.find(element => element.name === 'edge-anchor').height;
		}
		assert.deepEqual(protectedAfter, protectedBefore, 'protected nodes retain their content and geometry');
		assert.equal(await visibleBreaks(page, '[data-case="media-edge"]'), 0);
		assert.equal(await visibleBreaks(page, '[data-case="anchor-edge"]'), 0);
		assert.equal(await visibleBreaks(page, '[data-case="inline-protected"]'), 5, 'normal runs collapse on either side of protected code without entering it');
		assert.equal(await visibleBreaks(page, '[data-case="link-edge"]'), 2, 'only the link-owned breaks remain');
		assert.equal(await page.locator('#edge-anchor').count(), 1);
		assert.equal(await page.locator('[data-case="edge-link"]').innerHTML(), linkBefore, 'link-owned content remains intact');
		await page.locator('[data-case="edge-link"]').click();
		assert.equal(new URL(page.url()).hash, '#edge-anchor', 'the retained empty anchor remains a valid navigation target');
		assert.equal(await page.locator('#edge-anchor').count(), 1);
	} finally { await page.close(); }
});

test('an empty article has no visible blank lines and recovers when new content arrives', async () => {
	const page = await openArticle('dark', 'rtl');
	try {
		await page.locator('.flux_content .text').evaluate(body => { body.innerHTML = '<br><span> &nbsp;<br></span><p><br></p><br>'; });
		const original = await page.locator('.flux_content .text').textContent();
		await page.addScriptTag({ content: script });
		assert.equal(await visibleBreaks(page, '.flux_content .text'), 0);
		assert.equal(await page.locator('.flux_content .text').evaluate(body => body.getBoundingClientRect().height), 0, 'an entirely blank article adds no line box');
		assert.equal(await page.locator('.flux_content .text').textContent(), original);
		await page.locator('.flux_content .text').evaluate(body => {
			body.innerHTML = '<span><br></span><p data-case="recovered-edge">Recovered<br><br>text</p><span><br></span>';
		});
		await page.locator('.flux').evaluate(article => article.dispatchEvent(new Event('freshrss:openArticle', { bubbles: true })));
		assert.ok(await page.locator('[data-case="recovered-edge"]').isVisible());
		assert.equal(await visibleBreaks(page, '.flux_content .text'), 1);
		const spacing = await blockSpacing(page, '[data-case="recovered-edge"]');
		assert.equal(spacing.before, 0);
		assert.equal(spacing.after, 0);
		const once = await page.locator('.flux_content .text').innerHTML();
		await page.locator('.flux').evaluate(article => article.dispatchEvent(new Event('freshrss:openArticle', { bubbles: true })));
		assert.equal(await page.locator('.flux_content .text').innerHTML(), once);
	} finally { await page.close(); }
});

// Real feeds can use root text and media instead of wrapping prose in paragraphs.
test('root text articles trim boundary breaks and retain a final image without requiring paragraphs', async () => {
	const page = await openArticle('light', 'ltr');
	try {
		await page.locator('.flux_content .text').evaluate(body => {
			body.innerHTML = '<br><span><br></span>开头正文<br><br>第二行<br><span><br></span><img data-protected="root-image" width="80" height="40" alt=""><br><br>';
		});
		const original = await page.locator('.flux_content .text').textContent();
		const media = (await protectedContent(page)).map(({ lineHeight, ...appearance }) => appearance);
		await page.addScriptTag({ content: script });
		const ratio = await page.locator('.flux_content .text').evaluate(element => {
			const style = getComputedStyle(element);
			return parseFloat(style.lineHeight) / parseFloat(style.fontSize);
		});
		assert.ok(Math.abs(ratio - 1.395) < 0.001, 'root prose uses the same compact line height as ordinary paragraphs');
		assert.equal(await page.locator('.flux_content .text p').count(), 0);
		assert.equal(await visibleBreaks(page, '.flux_content .text'), 2, 'only the two breaks between actual content remain');
		assert.equal(await page.locator('.flux_content .text').textContent(), original);
		assert.deepEqual((await protectedContent(page)).map(({ lineHeight, ...appearance }) => appearance), media, 'the final image retains its source markup and rendered geometry');
		assert.ok(await page.locator('[data-protected="root-image"]').isVisible());
	} finally { await page.close(); }
});

test('hidden text does not create content boundaries while display contents keeps visible descendants', async () => {
	const page = await openArticle('light', 'ltr');
	try {
		await page.locator('.flux_content .text').evaluate(body => {
			body.innerHTML = '<p data-case="hidden-run">First<br><span data-case="hidden-text" style="display: none">Hidden</span><br>Second</p><p data-case="hidden-only"><br><span style="display: none">Hidden</span><br></p><div style="display: contents"><span data-case="contents-text">Visible through contents</span></div>';
		});
		const hidden = await page.locator('[data-case="hidden-text"]').evaluate(element => element.outerHTML);
		await page.addScriptTag({ content: script });
		assert.equal(await visibleBreaks(page, '[data-case="hidden-run"]'), 1, 'hidden text cannot divide a continuous break run');
		assert.equal(await page.locator('[data-case="hidden-only"]').evaluate(element => element.getBoundingClientRect().height), 0, 'hidden text cannot keep an otherwise blank paragraph open');
		assert.equal(await page.locator('[data-case="hidden-text"]').evaluate(element => element.outerHTML), hidden, 'source hidden content remains intact');
		assert.equal(await page.locator('[data-case="contents-text"]').innerText(), 'Visible through contents');
		assert.ok(await page.locator('[data-case="contents-text"]').isVisible(), 'display contents itself has no box but its text remains visible');
	} finally { await page.close(); }
});

test('flex and grid layouts retain empty positioning cells, gaps and their internal content', async () => {
	const page = await openArticle('dark', 'rtl');
	try {
		await page.locator('.flux_content .text').evaluate(body => {
			body.innerHTML = '<div data-protected="flex-layout" style="display: flex; gap: 12px"><div data-protected="flex-slot" style="width: 40px; height: 30px"></div><p>Flex<br><br>caption</p></div><section data-protected="grid-layout" style="display: grid; grid-template-columns: 50px 100px; gap: 12px"><div data-protected="grid-slot" style="height: 30px"></div><p>Grid<br><br>caption</p></section>';
		});
		const original = await protectedContent(page);
		const positions = await page.locator('[data-protected$="-layout"] p').evaluateAll(elements => elements.map(element => ({ left: element.getBoundingClientRect().left, width: element.getBoundingClientRect().width })));
		await page.addScriptTag({ content: script });
		assert.deepEqual(await protectedContent(page), original, 'custom layout subtrees retain every original node and style');
		assert.deepEqual(await page.locator('[data-protected$="-layout"] p').evaluateAll(elements => elements.map(element => ({ left: element.getBoundingClientRect().left, width: element.getBoundingClientRect().width }))), positions, 'empty slots keep captions in their original columns');
	} finally { await page.close(); }
});


test('simple div and section prose use compact line height without changing custom spacing', async () => {
	const page = await openArticle('dark', 'ltr');
	try {
		await page.locator('.flux_content .text').evaluate(body => {
			body.innerHTML = '<section data-case="section-prose">Section <span>inline</span><br><br>continues</section><div data-case="div-prose">Div text<br><br>continues</div><div data-protected="source-spacing" style="padding: 25px; margin: 30px 0; min-height: 10px">Custom layout</div>';
		});
		const custom = await protectedContent(page);
		await page.addScriptTag({ content: script });
		for (const name of ['section-prose', 'div-prose']) {
			const selector = `[data-case="${name}"]`;
			const ratio = await page.locator(selector).evaluate(element => {
				const style = getComputedStyle(element);
				return parseFloat(style.lineHeight) / parseFloat(style.fontSize);
			});
			assert.ok(Math.abs(ratio - 1.395) < 0.001, 'simple text containers use the ordinary compact line height');
			assert.equal(await visibleBreaks(page, selector), 1);
		}
		assert.deepEqual(await protectedContent(page), custom, 'a container with source spacing retains its original layout and line height');
	} finally { await page.close(); }
});

// Atomic inline boxes are inline content even when they own a separate inner layout.
test('atomic inline boxes preserve the single line breaks on both sides', async () => {
	const page = await openArticle('light', 'ltr');
	try {
		await page.addScriptTag({ content: script });
		const counts = [];
		for (const [display, content] of [['inline-block', 'B'], ['inline-flex', 'B'], ['inline-grid', 'B'], ['inline-block', '<div>B</div>']]) {
			await page.locator('.flux_content .text').evaluate((body, source) => {
				body.innerHTML = `<div data-case="atomic-inline">A<br><div data-case="atomic-box" style="display: ${source.display}">${source.content}</div><br>C</div>`;
			}, { display, content });
			const before = await page.locator('[data-case="atomic-box"]').innerHTML();
			await page.locator('.flux').evaluate(article => article.dispatchEvent(new Event('freshrss:openArticle', { bubbles: true })));
			counts.push({ display, content, breaks: await visibleBreaks(page, '[data-case="atomic-inline"]') });
			if (display !== 'inline-block') assert.equal(await page.locator('[data-case="atomic-box"]').innerHTML(), before, 'protected inline layout content remains intact');
		}
		assert.deepEqual(counts, [
			{ display: 'inline-block', content: 'B', breaks: 2 },
			{ display: 'inline-flex', content: 'B', breaks: 2 },
			{ display: 'inline-grid', content: 'B', breaks: 2 },
			{ display: 'inline-block', content: '<div>B</div>', breaks: 2 },
		], 'each atomic box separates two meaningful single line breaks');
	} finally { await page.close(); }
});

// Compact ancestors must not alter the inherited metrics of source layouts below them.
test('paragraph and root prose preserve descendant layouts with their original line metrics', async () => {
	const sources = [
		'<p>A<span data-protected="inline-layout" style="display: inline-flex"><span>B<br>C</span></span></p>',
		...['aside', 'blockquote', 'figure', 'article-note'].map(tag => `Root text<${tag} data-protected="source-layout" style="padding: 15px">Aside<br>content</${tag}>`),
	];
	for (const source of sources) {
		const page = await openArticle('light', 'ltr');
		try {
			await page.locator('.flux_content .text').evaluate((body, html) => { body.innerHTML = html; }, source);
			const original = await protectedContent(page);
			await page.addScriptTag({ content: script });
			assert.deepEqual(await protectedContent(page), original, 'ancestor compacting cannot alter protected descendant HTML, line height or geometry');
			if (source.startsWith('Root text')) {
				const ratio = await page.locator('.flux_content .text').evaluate(element => {
					const style = getComputedStyle(element);
					return parseFloat(style.lineHeight) / parseFloat(style.fontSize);
				});
				assert.ok(Math.abs(ratio - 1.7) < 0.001, 'the article root keeps its original line height when a descendant owns source layout');
			}
		} finally { await page.close(); }
	}
});

// Blank edge text must stop forming line boxes without losing original text-node identity.
test('NBSP at article edges adds no lines and recovers when the original blank text changes', async () => {
	for (const source of ['<span>&nbsp;</span><p data-case="nbsp-text">Text</p><span>&nbsp;</span>', '&nbsp;<p data-case="nbsp-text">Text</p>&nbsp;']) {
		const page = await openArticle('light', 'ltr');
		try {
			const original = await page.locator('.flux_content .text').evaluate((body, html) => {
				body.innerHTML = html;
				window.nbspOriginalNodes = [...body.childNodes];
				window.nbspLeadingText = body.firstChild.nodeType === Node.TEXT_NODE ? body.firstChild : body.firstChild.firstChild;
				return body.textContent;
			}, source);
			await page.addScriptTag({ content: script });
			const dimensions = await page.locator('.flux_content .text').evaluate(body => ({ body: body.getBoundingClientRect().height, paragraph: body.querySelector('p').getBoundingClientRect().height }));
			assert.ok(Math.abs(dimensions.body - dimensions.paragraph) < 0.1, 'edge NBSP cannot add an anonymous line box');
			const spacing = await blockSpacing(page, '[data-case="nbsp-text"]');
			assert.equal(spacing.before, 0);
			assert.equal(spacing.after, 0);
			assert.equal(await page.locator('.flux_content .text').textContent(), original, 'raw source text remains unchanged');
			assert.equal(await page.evaluate(() => window.nbspOriginalNodes.every(node => node.isConnected)), true, 'original source nodes remain connected');
			const once = await page.locator('.flux_content .text').innerHTML();
			await page.locator('.flux').evaluate(article => article.dispatchEvent(new Event('freshrss:openArticle', { bubbles: true })));
			assert.equal(await page.locator('.flux_content .text').innerHTML(), once, 'repeated blank-edge processing is stable');
			await page.evaluate(() => { window.nbspLeadingText.textContent = 'Recovered'; });
			await page.locator('.flux').evaluate(article => article.dispatchEvent(new Event('freshrss:openArticle', { bubbles: true })));
			assert.ok((await page.locator('.flux_content .text').innerText()).includes('Recovered'), 'the original blank text can become visible content');
			assert.equal(await page.evaluate(() => window.nbspLeadingText.isConnected), true);
			const recovered = await page.locator('.flux_content .text').innerHTML();
			await page.locator('.flux').evaluate(article => article.dispatchEvent(new Event('freshrss:openArticle', { bubbles: true })));
			assert.equal(await page.locator('.flux_content .text').innerHTML(), recovered, 'recovered text remains stable on another pass');
			await page.locator('.flux_content .text').evaluate(body => { body.innerHTML = '<p data-case="nbsp-word-space">first<span> </span>second</p>'; });
			await page.locator('.flux').evaluate(article => article.dispatchEvent(new Event('freshrss:openArticle', { bubbles: true })));
			assert.equal(await page.locator('[data-case="nbsp-word-space"]').innerText(), 'first second', 'inline word spacing remains intact');
		} finally { await page.close(); }
	}
});

// Clearing breaks and sized spacers carry layout even when they contain no text.
for (const theme of ['light', 'dark']) for (const direction of ['ltr', 'rtl']) {
	test(`${theme}/${direction}: clearing breaks retain float boundaries`, async () => {
		for (const clear of ['clear="all"', 'style="clear: both"']) {
			const page = await openArticle(theme, direction);
			try {
				await page.locator('.flux_content .text').evaluate((body, attribute) => {
					body.innerHTML = `<section data-case="float-section"><img style="float: left; width: 100px; height: 200px" alt="Image">Caption<br><br ${attribute}><br></section><p data-case="following">Next section</p><div><span data-case="clear-wrapper"><br ${attribute}></span></div><p data-case="ordinary-breaks"><br>First<br><br>Second<br></p>`;
				}, clear);
				const original = await page.locator('[data-case="clear-wrapper"]').innerHTML();
				await page.addScriptTag({ content: script });
				for (let pass = 0; pass < 2; pass++) {
					assert.equal(await page.locator('[data-case="clear-wrapper"]').innerHTML(), original, 'the clearing break is unchanged');
					assert.equal(await visibleBreaks(page, '[data-case="clear-wrapper"]'), 1, 'the empty wrapper cannot hide its clearing break');
					const bounds = await page.locator('.flux_content .text').evaluate(body => ({
						imageBottom: body.querySelector('img').getBoundingClientRect().bottom,
						sectionBottom: body.querySelector('section').getBoundingClientRect().bottom,
						nextTop: body.querySelector('[data-case="following"]').getBoundingClientRect().top,
					}));
					assert.ok(bounds.sectionBottom >= bounds.imageBottom, 'the section contains the float');
					assert.ok(bounds.nextTop >= bounds.imageBottom, 'the following paragraph stays below the image');
					assert.equal(await visibleBreaks(page, '[data-case="float-section"]'), 1, 'ordinary breaks cannot span the clearing boundary');
					assert.equal(await visibleBreaks(page, '[data-case="ordinary-breaks"]'), 1, 'ordinary blank-line cleanup still works');
					if (pass === 0) await page.locator('.flux').evaluate(article => article.dispatchEvent(new Event('freshrss:openArticle', { bubbles: true })));
				}
			} finally { await page.close(); }
		}
	});

	test(`${theme}/${direction}: sized empty containers retain their subtree and geometry`, async () => {
		const page = await openArticle(theme, direction);
		try {
			await page.addStyleTag({ content: '.fixture-minimum-space { min-height: 40px; } .fixture-padded-space { padding: 12px; }' });
			await page.locator('.flux_content .text').evaluate(body => {
				body.innerHTML = '<p>Before</p><section data-case="spacer-parent"><div data-protected="fixed-space" style="height: 40px; padding: 12px"></div><section data-protected="minimum-space" class="fixture-minimum-space"><span>&nbsp;<br><br></span></section><p data-protected="padded-space" class="fixture-padded-space"><span>&nbsp;<br><br></span></p><div data-protected="height-space" style="height: 40px"><br></div></section><p data-case="ordinary-empty">&nbsp;<br></p><div data-case="ordinary-container"><span>&nbsp;<br></span></div><p>After</p>';
			});
			const original = await protectedContent(page);
			const parentHeight = await page.locator('[data-case="spacer-parent"]').evaluate(element => element.getBoundingClientRect().height);
			await page.addScriptTag({ content: script });
			for (let pass = 0; pass < 2; pass++) {
				assert.deepEqual(await protectedContent(page), original, 'explicit spacing preserves the complete subtree and rendered dimensions');
				assert.equal(await page.locator('[data-case="spacer-parent"]').evaluate(element => element.getBoundingClientRect().height), parentHeight, 'protected descendants keep their parent open');
				for (const name of ['ordinary-empty', 'ordinary-container']) {
					assert.equal(await page.locator(`[data-case="${name}"]`).isVisible(), false, 'ordinary empty blocks still collapse');
				}
				if (pass === 0) await page.locator('.flux').evaluate(article => article.dispatchEvent(new Event('freshrss:openArticle', { bubbles: true })));
			}
		} finally { await page.close(); }
	});
}
