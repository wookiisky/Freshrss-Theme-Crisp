import assert from 'node:assert/strict';

// Calculate WCAG relative luminance for opaque palette or browser-computed colours.
function luminance(hex) {
	let channels;
	if (hex.startsWith('rgb(')) channels = hex.match(/[\d.]+/g).map(Number);
	else {
		assert.match(hex ?? '', /^#(?:[\da-f]{3}|[\da-f]{6})$/i, 'colour roles must resolve to opaque colours');
		const digits = hex.slice(1);
		const rgb = digits.length === 3 ? [...digits].map(value => value.repeat(2)).join('') : digits;
		channels = rgb.match(/../g).map(value => parseInt(value, 16));
	}
	const linear = channels.map(value => {
		const channel = value / 255;
		return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
	});
	return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

// Compare colours by contrast, independently of the chosen light or dark palette.
export function contrast(first, second) {
	const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
	return (values[0] + 0.05) / (values[1] + 0.05);
}
