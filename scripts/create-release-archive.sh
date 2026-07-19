#!/usr/bin/env bash
set -Eeuo pipefail

project_root="$(cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$project_root"

name="$(node -p "require('./package.json').name")"
version="$(node -p "require('./package.json').version")"
output_dir="$project_root/release"
if [[ $# -gt 0 ]]; then
  output_dir="$1"
fi

archive_name="$name-$version.tar.gz"
archive_path="$output_dir/$archive_name"
checksum_path="$archive_path.sha256"

[[ -d .git ]] || {
  printf 'Run this from a committed Netbrowse Voice Git checkout.\n' >&2
  exit 1
}

git diff --quiet || {
  printf 'Refusing to archive uncommitted changes. Commit or stash them first.\n' >&2
  exit 1
}

git diff --cached --quiet || {
  printf 'Refusing to archive staged but uncommitted changes. Commit them first.\n' >&2
  exit 1
}

if [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
  printf 'Refusing to archive untracked files. Add, remove or ignore them first.\n' >&2
  exit 1
fi

mkdir -p "$output_dir"
rm -f -- "$archive_path" "$checksum_path"

git archive --format=tar --prefix="$name-$version/" HEAD |
  gzip -n > "$archive_path"

(
  cd "$output_dir"
  sha256sum "$archive_name" > "$archive_name.sha256"
)

tar -tzf "$archive_path" >/dev/null
(
  cd "$output_dir"
  sha256sum -c "$archive_name.sha256"
)

printf 'Created %s\nCreated %s\n' "$archive_path" "$checksum_path"
