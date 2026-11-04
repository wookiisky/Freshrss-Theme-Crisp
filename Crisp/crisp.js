// @license magnet:?xt=urn:btih:0b31508aeb0634b347b8270c7bee4d411b5d4109&dn=agpl-3.0.txt AGPL-3.0
/* global context */
'use strict';

(function () {
	const articleBodySelector = '.flux_content .content .text';
	const preservedElements = 'pre, code, kbd, samp, textarea, table, svg, math, img, picture, audio, video, iframe, object, embed, canvas, hr, input, button, select, a[href], [contenteditable], [tabindex], [role]';
	const layoutElements = 'table, svg, math, img, picture, audio, video, iframe, object, embed, canvas, input, button, select, textarea, [id], [name]';
	const blankBlocks = new Set(['P', 'DIV', 'SECTION']);
	const textWrappers = new Set(['SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'SMALL', 'SUB', 'SUP', 'FONT', 'MARK', 'ABBR', 'A']);
	const preservedWhitespace = new Set(['pre', 'pre-wrap', 'pre-line', 'break-spaces']);
	const preservedDisplays = new Set(['flex', 'inline-flex', 'grid', 'inline-grid', 'inline-block', 'inline-table', 'ruby', 'ruby-text']);
	const articleMarks = ['crisp-paragraph', 'crisp-prose', 'crisp-heading', 'crisp-empty', 'crisp-extra-break', 'crisp-first-paragraph', 'crisp-last-paragraph'];

	// Empty painted or anchored elements can still carry content or a navigation target.
	function hasVisibleDecoration(element, style) {
		if (style.backgroundImage !== 'none' || style.backgroundColor !== 'rgba(0, 0, 0, 0)' || style.boxShadow !== 'none') return true;
		if (['Top', 'Right', 'Bottom', 'Left'].some(side => parseFloat(style[`border${side}Width`]) > 0)) return true;
		if (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) return true;
		return ['::before', '::after'].some(pseudo => {
			const decoration = getComputedStyle(element, pseudo);
			return decoration.display !== 'none' && !['none', 'normal'].includes(decoration.content);
		});
	}

	// Explicit size and padding can make an empty node a spacer; default paragraph margins cannot.
	function hasContainerSizing(element, style) {
		return [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft]
			.some(value => parseFloat(value) > 0) || parseFloat(style.minHeight) > 0 ||
			Boolean(element.style.height && element.style.height !== 'auto');
	}

	// Custom container spacing remains a source layout, even when its text is ordinary.
	function hasContainerLayout(element, style) {
		return [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft]
			.some(value => parseFloat(value) !== 0) || hasContainerSizing(element, style) || hasVisibleDecoration(element, style);
	}

	// Both paragraphs and direct prose must preserve the inherited styles of source layouts.
	function preservesTextLayout(element) {
		const style = getComputedStyle(element);
		if (style.display === 'none') return false;
		return element.matches('pre, code, kbd, samp, textarea, table, [contenteditable], [tabindex], [role]') ||
			preservedWhitespace.has(style.whiteSpace) || preservedDisplays.has(style.display) || hasContainerLayout(element, style);
	}

	// Read the original layout first, then apply marks without replacing source nodes or text.
	function normaliseArticle(body) {
		body.querySelectorAll('[data-crisp-whitespace]').forEach(wrapper => wrapper.replaceWith(...wrapper.childNodes));
		body.classList.remove(...articleMarks);
		body.querySelectorAll(articleMarks.map(name => `.${name}`).join(',')).forEach(element => element.classList.remove(...articleMarks));
		const marks = [];
		const contentEdges = [];
		const emptyWrappers = [];
		const hiddenWhitespace = [];

		// Only a break between two pieces of inline content has a visible purpose.
		function finishFlow(flow, hasContent = false) {
			const keep = hasContent && flow.hasContent ? 1 : 0;
			for (const br of flow.breaks.slice(keep)) marks.push([br, 'crisp-extra-break']);
			if (!keep) {
				for (const node of flow.whitespace) {
					if (node.nodeType === Node.ELEMENT_NODE) marks.push([node, 'crisp-empty']);
					else if (/[^\t\n\f\r ]/.test(node.textContent)) hiddenWhitespace.push(node);
				}
			}
			flow.breaks = [];
			flow.whitespace = [];
			flow.hasContent = hasContent;
		}

		// Inline wrappers share pending breaks; each block owns a separate text flow.
		function visit(node, flow) {
			if (node.nodeType === Node.TEXT_NODE) {
				const blank = node.textContent.trim() === '';
				if (!blank) {
					finishFlow(flow, true);
					flow.hasText = true;
					contentEdges.push(node.parentElement);
				} else flow.whitespace.push(node);
				return blank;
			}
			if (node.nodeType === Node.COMMENT_NODE) return true;
			if (node.nodeType !== Node.ELEMENT_NODE) return false;

			const style = getComputedStyle(node);
			if (style.display === 'none') return true;
			const block = node.tagName !== 'BR' && !style.display.startsWith('inline') && !['contents', 'ruby', 'ruby-text'].includes(style.display);
			if (node.matches(preservedElements) || preservedWhitespace.has(style.whiteSpace) ||
				preservedDisplays.has(style.display)) {
				finishFlow(flow, !block);
				contentEdges.push(node);
				if (!block && node.textContent.trim()) flow.hasText = true;
				return false;
			}

			const candidate = node !== body && (blankBlocks.has(node.tagName) || textWrappers.has(node.tagName) || node.tagName === 'BR');
			const anchored = node !== body && Boolean(node.id || node.getAttribute('name') || node.getAttribute('aria-label') || node.getAttribute('aria-labelledby'));
			const heading = /^H[1-6]$/.test(node.tagName);
			const emptyText = node.textContent.trim() === '';
			const decorated = ((candidate && (emptyText || node.tagName === 'P')) || heading) && hasVisibleDecoration(node, style);
			// Protect the complete spacer before visiting children that contribute to its height.
			const sizedSpacer = candidate && emptyText && hasContainerSizing(node, style);
			if ((anchored && emptyText) || decorated || sizedSpacer) {
				finishFlow(flow, !block);
				contentEdges.push(node);
				return false;
			}

			if (node.tagName === 'BR') {
				// A clearing break ends a float layout, rather than adding an ordinary blank line.
				if (style.clear !== 'none') {
					finishFlow(flow);
					contentEdges.push(node);
					return false;
				}
				flow.breaks.push(node);
				return true;
			}

			if (block) finishFlow(flow);
			const innerFlow = block ? { breaks: [], whitespace: [], hasContent: false, hasText: false } : flow;
			let blank = node === body || (candidate && !anchored);
			for (const child of node.childNodes) {
				if (!visit(child, innerFlow)) blank = false;
			}
			if (block) finishFlow(innerFlow);

			if (blank && (blankBlocks.has(node.tagName) || node === body)) {
				if (node !== body || !hasVisibleDecoration(node, style)) marks.push([node, 'crisp-empty']);
			} else if (blank && textWrappers.has(node.tagName)) {
				emptyWrappers.push(node);
				flow.whitespace.push(node);
			}
			if (['block', 'flow-root'].includes(style.display) && !node.querySelector(layoutElements)) {
				if (node.tagName === 'P') {
					// A paragraph must not change the line height inherited by protected text inside it.
					const preservesText = [...node.querySelectorAll('*')].some(preservesTextLayout);
					if (!preservesText) marks.push([node, 'crisp-paragraph']);
				}
				else if (heading) marks.push([node, 'crisp-heading']);
			}
			// Direct text also occurs at the article root and in simple source containers.
			if (block && innerFlow.hasText && (node === body || ['DIV', 'SECTION'].includes(node.tagName))) {
				const simple = node === body || !hasContainerLayout(node, style);
				const preservesText = [...node.querySelectorAll('*')].some(preservesTextLayout);
				if (simple && !preservesText) marks.push([node, 'crisp-prose']);
			}
			return blank;
		}

		visit(body, { breaks: [], whitespace: [], hasContent: false, hasText: false });
		const hiddenBreaks = new Set(marks.filter(([, name]) => name === 'crisp-extra-break').map(([element]) => element));
		for (const wrapper of emptyWrappers) {
			const breaks = [...wrapper.querySelectorAll('br')];
			if (breaks.length && breaks.every(br => hiddenBreaks.has(br))) marks.push([wrapper, 'crisp-empty']);
		}
		for (const [element, name] of marks) element.classList.add(name);
		// A bare non-breaking space has no element to hide; keep its original text node in a reversible wrapper.
		for (const node of hiddenWhitespace) {
			if (node.parentElement.closest('.crisp-empty')) continue;
			const wrapper = document.createElement('span');
			wrapper.dataset.crispWhitespace = '';
			wrapper.classList.add('crisp-empty');
			node.before(wrapper);
			wrapper.appendChild(node);
		}
		for (const [edge, name] of [[contentEdges[0], 'crisp-first-paragraph'], [contentEdges.at(-1), 'crisp-last-paragraph']]) {
			const paragraph = edge?.closest('p');
			if (paragraph?.classList.contains('crisp-paragraph')) paragraph.classList.add(name);
		}
	}

	// Restrict every pass to article bodies, including content replaced in an existing body.
	function normaliseArticles(container) {
		if (container.nodeType === Node.ELEMENT_NODE && container.matches(articleBodySelector)) normaliseArticle(container);
		else container.querySelectorAll(articleBodySelector).forEach(normaliseArticle);
	}

	// Keep feed/category grouping while hiding date separators, including AJAX entries.
	function updateDateGrouping() {
		const sort = typeof context === 'undefined' ? undefined : context.sort;
		document.documentElement.classList.toggle('crisp-date-order', ['id', 'date', 'lastUserModified'].includes(sort));
	}

	// Move the original controls so their forms, IDs and event handlers remain intact.
	function initialiseToolbar() {
		const header = document.querySelector('.header');
		const navigation = document.querySelector('#global > nav.nav_menu');
		if (header && navigation) {
			header.insertBefore(navigation, header.querySelector('.search'));
			document.documentElement.classList.add('crisp-toolbar');
		}
		updateDateGrouping();
	}

	// The initial pass also covers the reading view, where articles are already expanded.
	function initialiseTheme() {
		initialiseToolbar();
		// Separate category text from its counter so flex layout can truncate only the label.
		document.querySelectorAll('.aside_feed .tree-folder-title > .title').forEach(title => {
			if (title.querySelector('.crisp-category-label')) return;
			const label = document.createElement('span');
			label.className = 'crisp-category-label';
			label.append(...title.childNodes);
			title.append(label);
		});
		normaliseArticles(document);
	}

	// Theme and core scripts are asynchronous; either may become ready first.
	document.addEventListener('freshrss:globalContextLoaded', updateDateGrouping);
	document.addEventListener('freshrss:openArticle', event => normaliseArticles(event.target));
	document.addEventListener('freshrss:load-more', () => normaliseArticles(document.getElementById('stream') || document));
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initialiseTheme, { once: true });
	} else {
		initialiseTheme();
	}
}());
// @license-end
