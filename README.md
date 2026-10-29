# Crisp for FreshRSS

[English](README.md) | [简体中文](README.zh-CN.md)

Compact, flat themes for FreshRSS, available as **Crisp Light** and **Crisp Dark** with fixed colour palettes.

## Screenshots

The screenshots use sample feeds to show the current styles: the first article is selected, the second is hovered, the third and fifth are read, and the remaining articles are unread.

### Crisp Light

Warm white surfaces, warm grey text and burnt-orange accents. The screenshot uses sample feeds.

![Crisp Light theme screenshot](Crisp/thumbs/original.png)

### Crisp Dark

Ink-grey surfaces, soft light text and teal accents. The screenshot uses sample feeds.

![Crisp Dark theme screenshot](Crisp-Dark/thumbs/original.png)

## Design

Crisp starts from FreshRSS's bundled Flat design theme and uses surface colours, fine dividers and small corner radii to distinguish interface elements.
Both editions share component styles and layout, with separate palettes for a consistent reading experience.

- **Compact lists**: less vertical space in feed and article lists, larger text and comfortable article line spacing.
- **Combined header**: search and reading controls share one toolbar, wrapping on narrow screens or when zoomed in. A 2px divider clearly separates the toolbar from the reading area.
- **Simpler date grouping**: date headings and jump links are hidden when sorting by reception, publication or modification time. Article dates, feed groups and category groups remain available.
- **Clear hover feedback**: the light theme uses a darker warm-grey fill and the dark theme a brighter blue-grey fill on buttons, navigation, menus and article headers.
- **Selection**: navigation and the current article keep their selection backgrounds and edge markers on hover. Button selection changes only the border colour, preserving the normal text, icons and background; hover, pressing and keyboard focus retain their own feedback.
- **Reading states**: read and unread articles use different backgrounds with the same font weight. The current article keeps its accent edge even when starred, while stars and read/unread icons retain their meaning. Informational messages retain softer backgrounds.
- **Recognisable controls**: buttons and inputs have stronger outlines than list dividers. Press feedback is immediate; disabled controls keep any persistent selection without responding to hover. Colour transitions respect reduced-motion preferences.
- **Fixed palettes**: select the light or dark edition in FreshRSS; neither follows the operating system's colour preference.
- **RTL support**: generated stylesheets are included for languages written from right to left.

## Installation

An existing FreshRSS installation is required. This repository contains themes only; FreshRSS provides the base styles and icons.

1. Download this repository or clone it with the command below.
2. Copy **both `Crisp` and `Crisp-Dark` directories** into FreshRSS's `p/themes/` directory.
3. Select **Crisp Light** or **Crisp Dark** in FreshRSS's display settings.

```sh
git clone https://github.com/wookiisky/Freshrss-Theme-Crisp.git
cp -R Freshrss-Theme-Crisp/Crisp Freshrss-Theme-Crisp/Crisp-Dark /path/to/FreshRSS/p/themes/
```

Replace `/path/to/FreshRSS` with your installation path. Keep the original directory names and install them side by side.
The dark edition loads shared CSS and JavaScript from `Crisp`, so both directories must be installed together.

## Files and tests

- `Crisp/light.css`: light palette.
- `Crisp-Dark/dark.css`: dark palette.
- `Crisp/crisp.css` and `Crisp/layout.css`: shared component styles and responsive layout.
- `Crisp/crisp.js`: moves the existing toolbar and identifies date sorting while preserving controls and event handlers.
- `*.rtl.css`: generated RTL stylesheets; regenerate these from their corresponding CSS files when maintaining the styles.

Run the interaction and palette tests from the repository root using Node.js:

```sh
node --test tests/frontend/*.test.mjs
```

Browser state tests additionally require the development dependencies, an installed Google Chrome and a FreshRSS checkout:

```sh
npm ci
FRESHRSS_ROOT=/path/to/FreshRSS npm run test:browser
```

These tests load FreshRSS's actual base CSS and icons with representative component markup, checking light/dark palettes and LTR/RTL states. They cover selection, unread/favourite combinations, disabled controls, pressing, keyboard focus and reduced motion. Missing FreshRSS files or Chrome cause a failure rather than a skipped check. `CRISP_BROWSER_CHANNEL` can select another installed Playwright browser channel. The development dependencies are not needed to install or use the themes.

## Credits and licence

Inspired by the Flat design theme bundled with [FreshRSS](https://github.com/FreshRSS/FreshRSS).
This repository retains FreshRSS's GNU AGPL v3 licence; see [LICENSE.txt](LICENSE.txt).
