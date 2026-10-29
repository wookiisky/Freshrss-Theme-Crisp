#!/bin/sh
set -eu

# Resolve the project from this script, including paths containing spaces.
cd "$(dirname "$0")/.."
mkdir -p dist
archive_dir=$(mktemp -d dist/.crisp-package.XXXXXX)
trap 'rm -rf "$archive_dir"' 0
trap 'exit 1' HUP INT TERM

# Start a fresh archive; publish it only after all required inputs are packed.
zip -q -r -X -MM "$archive_dir/freshrss-theme-crisp.zip" \
	Crisp Crisp-Dark README.md README.zh-CN.md LICENSE.txt \
	-x '*/.DS_Store' '*/._*' '*/Thumbs.db' '*/desktop.ini' '*/__MACOSX/*'
mv -f "$archive_dir/freshrss-theme-crisp.zip" dist/freshrss-theme-crisp.zip
