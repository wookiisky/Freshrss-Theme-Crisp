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
	const articleMarks = ['crisp-paragraph', 'crisp-heading', 'crisp-empty', 'crisp-extra-break'];

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

	// Read the original layout first, then apply marks without replacing source nodes or text.
	function normaliseArticle(body) {
		body.querySelectorAll(articleMarks.map(name => `.${name}`).join(',')).forEach(element => element.classList.remove(...articleMarks));
		const marks = [];

		// Inline wrappers share a break counter; block boundaries and protected content reset it.
		function visit(node, flow) {
			if (node.nodeType === Node.TEXT_NODE) {
				const blank = node.textContent.trim() === '';
				if (!blank) flow.breaks = 0;
				return blank;
			}
			if (node.nodeType === Node.COMMENT_NODE) return true;
			if (node.nodeType !== Node.ELEMENT_NODE) return false;

			const style = getComputedStyle(node);
			if (node.matches(preservedElements) || preservedWhitespace.has(style.whiteSpace)) {
				flow.breaks = 0;
				return false;
			}

			const block = node.tagName !== 'BR' && !['inline', 'contents'].includes(style.display);
			const candidate = node !== body && (blankBlocks.has(node.tagName) || textWrappers.has(node.tagName) || node.tagName === 'BR');
			const anchored = node !== body && Boolean(node.id || node.getAttribute('name') || node.getAttribute('aria-label') || node.getAttribute('aria-labelledby'));
			const heading = /^H[1-6]$/.test(node.tagName);
			const emptyText = node.textContent.trim() === '';
			const decorated = ((candidate && (emptyText || node.tagName === 'P')) || heading) && hasVisibleDecoration(node, style);
			if ((anchored && emptyText) || decorated) {
				flow.breaks = 0;
				return false;
			}

			if (node.tagName === 'BR') {
				if (++flow.breaks > 2) marks.push([node, 'crisp-extra-break']);
				return true;
			}

			if (block) flow.breaks = 0;
			const innerFlow = block ? { breaks: 0 } : flow;
			let blank = candidate && !anchored;
			for (const child of node.childNodes) {
				if (!visit(child, innerFlow)) blank = false;
			}
			if (block) flow.breaks = 0;

			if (blank && blankBlocks.has(node.tagName)) marks.push([node, 'crisp-empty']);
			if (['block', 'flow-root'].includes(style.display) && !node.querySelector(layoutElements)) {
				if (node.tagName === 'P') {
					// A paragraph must not change the line height inherited by protected text inside it.
					const preservesText = [...node.querySelectorAll('*')].some(child =>
						child.matches('pre, code, kbd, samp') || preservedWhitespace.has(getComputedStyle(child).whiteSpace));
					if (!preservesText) marks.push([node, 'crisp-paragraph']);
				}
				else if (heading) marks.push([node, 'crisp-heading']);
			}
			return blank;
		}

		visit(body, { breaks: 0 });
		for (const [element, name] of marks) element.classList.add(name);
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
