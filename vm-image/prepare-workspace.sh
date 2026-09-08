#!/bin/sh
set -eu

workspace=/home/cua/workspace
profiles="$workspace/.browser-profiles"
mkdir -p "$profiles/google-chrome" "$profiles/chromium" "$HOME/.config"
if ! chmod 0700 "$workspace" "$profiles" "$profiles/google-chrome" "$profiles/chromium" 2>/dev/null; then
  for directory in "$workspace" "$profiles" "$profiles/google-chrome" "$profiles/chromium"; do
    test -r "$directory" && test -w "$directory" && test -x "$directory"
  done
fi

migrate_profile() {
  name="$1"
  source="$HOME/.config/$name"
  target="$profiles/$name"
  if [ -d "$source" ] && [ ! -L "$source" ] && [ -z "$(find "$target" -mindepth 1 -print -quit)" ]; then
    cp -a "$source"/. "$target"/
  fi
  rm -rf "$source"
  ln -s "$target" "$source"
}

migrate_profile google-chrome
migrate_profile chromium
find "$profiles" \( -name SingletonLock -o -name SingletonSocket -o -name SingletonCookie -o -name .parentlock \) -delete
