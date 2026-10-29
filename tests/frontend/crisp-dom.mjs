// Minimal DOM boundary for verifying that Crisp preserves existing controls.
export function createCrispDocument({ toolbar = true, search = true, readyState = 'complete' } = {}) {
	const listeners = new Map();
	const classes = new Set();
	const navigation = { id: 'toolbar', onClick: () => 'existing handler' };
	const panelNavigation = { id: 'panel-toolbar' };
	const searchControl = { id: 'search' };
	const header = {
		children: [{ id: 'brand' }, ...(search ? [searchControl] : []), { id: 'settings' }],
		querySelector: () => search ? searchControl : null,
		insertBefore(node, reference) {
			this.children = this.children.filter(child => child !== node);
			const index = reference ? this.children.indexOf(reference) : this.children.length;
			this.children.splice(index, 0, node);
			navigation.inHeader = true;
		},
	};
	const document = {
		readyState,
		documentElement: {
			classList: {
				add: name => classes.add(name),
				toggle(name, enabled) {
					if (enabled) classes.add(name);
					else classes.delete(name);
				},
			},
		},
		querySelector(selector) {
			if (selector === '.header') return header;
			if (selector === '#global > nav.nav_menu') return toolbar && !navigation.inHeader ? navigation : null;
			return null;
		},
		addEventListener(event, callback) {
			listeners.set(event, callback);
		},
	};
	return { document, header, navigation, panelNavigation, searchControl, classes, listeners };
}
