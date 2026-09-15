#!/usr/bin/env bash
# GitHub Pages storefront rollback: force-push the user-site repo's main
# branch back to the commit that was live before the failed release. The repo
# is deployment-dedicated (its history only holds published releases), so a
# force-push is the exact restore. Called by rollback-github-pages.yml.
set -euo pipefail

require_command() {
  local name="$1"
  if ! command -v "${name}" >/dev/null 2>&1; then
    echo "Required command '${name}' was not found on PATH." >&2
    exit 1
  fi
}

require_env() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "${value}" ]]; then
    echo "Missing required environment variable: ${name}" >&2
    exit 1
  fi
}

require_command git
require_command curl
require_command jq
require_env ROLLBACK_REF
require_env GH_PAGES_TOKEN
require_env GITHUB_PAGES_OWNER

rollback_ref="${ROLLBACK_REF}"
repo="${GITHUB_PAGES_REPO}"
branch="${GITHUB_PAGES_BRANCH:-main}"

case "${rollback_ref}" in
  *[!0-9a-fA-F]*)
    echo "ROLLBACK_REF must be a 40-hex commit SHA of ${repo} (received '${rollback_ref}')." >&2
    exit 1
    ;;
esac
if [ "${#rollback_ref}" -ne 40 ]; then
  echo "ROLLBACK_REF must be a full 40-hex commit SHA (received ${#rollback_ref} chars)." >&2
  exit 1
fi

repo_dir="$(mktemp -d)"
git clone "https://x-access-token:${GH_PAGES_TOKEN}@github.com/${GITHUB_PAGES_OWNER}/${repo}.git" "${repo_dir}"
cd "${repo_dir}"

git cat-file -e "${rollback_ref}^{commit}" 2>/dev/null || {
  git fetch origin "${rollback_ref}" >/dev/null 2>&1 || true
  git cat-file -e "${rollback_ref}^{commit}" 2>/dev/null || {
    echo "Rollback commit ${rollback_ref} is not present in ${repo}; refusing to roll back." >&2
    exit 1
  }
}

current_sha="$(git rev-parse "origin/${branch}" 2>/dev/null || git rev-parse HEAD)"
if [ "${current_sha}" = "${rollback_ref}" ]; then
  echo "${repo} ${branch} already serves ${rollback_ref}; nothing to roll back."
  exit 0
fi

echo "Restoring ${repo} ${branch} from ${current_sha:0:12} to ${rollback_ref:0:12}."
# Remove everything tracked, then restore the exact prior tree: a revert
# commit that carries no stale files from the failed release, without a
# force-push (the repo is deployment-dedicated; history stays append-only).
git rm -rq --ignore-unmatch .
git checkout "${rollback_ref}" -- .
git config user.name "aura-release-bot"
git config user.email "actions@users.noreply.github.com"
git commit --allow-empty -m "rollback to release ${rollback_ref}"
git push origin "HEAD:${branch}"

sleep 10
production_url="${GITHUB_PAGES_PRODUCTION_URL%/}"
if [ -n "${production_url}" ]; then
  curl --fail --show-error --silent --location --max-time 30 "${production_url}" >/dev/null || true
fi

echo "GitHub Pages rollback to ${rollback_ref} completed."
