// @license magnet:?xt=urn:btih:0b31508aeb0634b347b8270c7bee4d411b5d4109&dn=agpl-3.0.txt AGPL-3.0
/* global context */
'use strict';

(function () {
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

	// Theme and core scripts are asynchronous; either may become ready first.
	document.addEventListener('freshrss:globalContextLoaded', updateDateGrouping);
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initialiseToolbar, { once: true });
	} else {
		initialiseToolbar();
	}
}());
// @license-end
