#!/bin/sh

set -eu

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "This directory is not a Git repository."
  exit 1
fi

message="${*:-snapshot $(date '+%Y-%m-%d %H:%M:%S')}"

git add -A

if git diff --cached --quiet; then
  echo "No changes to save."
  exit 0
fi

git commit -m "$message"
