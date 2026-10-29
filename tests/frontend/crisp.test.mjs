import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createCrispDocument } from './crisp-dom.mjs';

const source = readFileSync(new URL('../../Crisp/crisp.js', import.meta.url), 'utf8');

// Execute the browser entry point against the control identity boundary.
function start(options = {}, context = { sort: 'id' }) {
	const dom = createCrispDocument(options);
	const sandbox = vm.createContext({ document: dom.document, context });
	if (options.contextMissing) delete sandbox.context;
	vm.runInContext(source, sandbox);
	return { ...dom, sandbox };
}

test('moves the original toolbar before search and preserves its bound handler', () => {
	const dom = start();
	assert.deepEqual(dom.header.children.map(node => node.id), ['brand', 'toolbar', 'search', 'settings']);
	assert.equal(dom.header.children[1], dom.navigation);
	assert.equal(dom.navigation.onClick(), 'existing handler');
	assert.equal(dom.panelNavigation.id, 'panel-toolbar');
});

test('initialisation is safe on configuration pages and when repeated', () => {
	const config = start({ toolbar: false });
	assert.equal(config.header.children.length, 3);
	assert.equal(config.classes.has('crisp-toolbar'), false);
	const dom = start();
	vm.runInContext(source, dom.sandbox);
	assert.equal(dom.header.children.filter(node => node === dom.navigation).length, 1);
});

test('waits for the DOM when the asynchronous theme script loads early', () => {
	const dom = start({ readyState: 'loading' });
	assert.equal(dom.navigation.inHeader, undefined);
	dom.listeners.get('DOMContentLoaded')();
	assert.equal(dom.navigation.inHeader, true);
});

test('hides only date grouping and supports context arriving after the theme script', () => {
	for (const sort of ['id', 'date', 'lastUserModified']) {
		assert.equal(start({}, { sort }).classes.has('crisp-date-order'), true);
	}
	for (const sort of ['f.name', 'c.name', 'rand', undefined]) {
		assert.equal(start({}, { sort }).classes.has('crisp-date-order'), false);
	}
	const dom = start({ contextMissing: true });
	assert.equal(dom.classes.has('crisp-date-order'), false);
	dom.sandbox.context = { sort: 'date' };
	dom.listeners.get('freshrss:globalContextLoaded')();
	assert.equal(dom.classes.has('crisp-date-order'), true);
});
