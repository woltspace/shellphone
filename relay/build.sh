#!/bin/sh
# Puts the relay's site together in site/: its own pages (public/) and the chat page as the repo built it (../dist).
# Runs by itself before `wrangler dev` and `wrangler deploy`. Nothing here is edited by hand.
set -eu
cd "$(dirname "$0")"
rm -rf site && mkdir -p site
cp -R public/. site/
cp -R ../dist/assets site/assets
cp ../dist/index.html site/room.html
cp ../icon-180.png ../icon-512.png ../room-icon.png ../manifest.webmanifest site/
