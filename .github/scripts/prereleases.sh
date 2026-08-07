#!/usr/bin/env bash
#
# Shared inventory/selection/removal for preview prereleases. Every workflow
# that removes one routes through here so the error handling lives in ONE place.
#
# This exists because three workflows each carried their own copy of the same
# paginate-then-delete loop, and every copy ended its DELETEs with `|| true`.
# A failed delete was indistinguishable from a successful one, so the jobs
# reported success while 33 orphaned prereleases accumulated over three months.
# Deletes here fail the job instead.
#
#   prereleases.sh list      -> "<id>\t<tag>" for every prerelease
#   prereleases.sh orphans   -> "<id>\t<tag>" for the ones nothing needs any
#                               more (decisions logged to stderr)
#   prereleases.sh for-pr N [keep]
#                            -> "<id>\t<tag>" for PR N's previews, minus [keep]
#   prereleases.sh release-less-tags
#                            -> "-\t<tag>" for preview/RC tags with no release
#   prereleases.sh delete    -> reads "<id>\t<tag>" on stdin, removes the
#                               release and its tag
#   prereleases.sh selftest  -> asserts the version rule; needs no network
#
# env: GH_TOKEN (contents: write for delete), GH_REPO (owner/name),
#      DRY_RUN=1 (delete lists what it would remove and exits)
set -euo pipefail

# --- pure helpers (covered by selftest) --------------------------------------

# True when $1 (a bare x.y.z) is at or below $2, the current stable. Compares
# numerically per component: a lexical compare puts 1.9.26 and 1.2.0 ABOVE
# 1.20.1 and would keep spent RCs forever.
version_superseded() {
	local base="$1" stable="$2" newest
	newest=$(printf '%s\n%s\n' "$base" "$stable" | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)
	[ "$newest" = "$stable" ]
}

# The PR number embedded in a preview tag (<version>-pr.<N>[.<sha>]).
preview_pr_number() {
	sed -E 's/.*-pr\.([0-9]+).*/\1/' <<<"$1"
}

# Keep only "<id>\t<tag>" lines whose tag is a preview of PR $1, dropping tag $2
# if given. Compares the PR field EXACTLY rather than regex-matching a prefix:
# a `-pr.35` prefix match also hits `-pr.354`, and passing an escaped regex
# through `awk -v` silently loses the backslashes (awk unescapes the assignment,
# so `\.` degrades to "any character" and the boundary guard evaporates).
filter_pr() {
	awk -F'\t' -v pr="$1" -v keep="${2:-}" '
		$2 ~ /-pr\./ {
			n = $2
			sub(/.*-pr\./, "", n)   # drop everything up to the PR number
			sub(/\..*/, "", n)      # drop the .<sha> suffix if present
			if (n == pr && $2 != keep) print
		}'
}

# --- subcommands -------------------------------------------------------------

require_env() {
	: "${GH_TOKEN:?GH_TOKEN required}"
	: "${GH_REPO:?GH_REPO required}"
	API="https://api.github.com/repos/${GH_REPO}"
	AUTH=(-H "Authorization: Bearer ${GH_TOKEN}" -H "Accept: application/vnd.github+json")
}

cmd_list() {
	require_env
	local page=1 batch n
	while :; do
		batch=$(curl --fail -sS "${AUTH[@]}" "${API}/releases?per_page=100&page=${page}")
		n=$(jq 'length' <<<"$batch")
		if [ "$n" -eq 0 ]; then break; fi
		jq -r '.[] | select(.prerelease==true) | "\(.id)\t\(.tag_name)"' <<<"$batch"
		if [ "$n" -lt 100 ]; then break; fi
		page=$((page + 1))
	done
}

cmd_for_pr() {
	local pr="${1:?PR number required}" keep="${2:-}"
	cmd_list | filter_pr "$pr" "$keep"
}

# Preview/RC TAGS that have no release, emitted as "-\t<tag>" so `delete` skips
# the release call. Enumerating releases alone can never see these: deleting a
# release leaves its tag behind, which is exactly what the old `|| true` on the
# tag DELETE produced (release gone, tag delete failed, nobody told). Without
# this they are unreachable by any sweep, forever.
cmd_release_less_tags() {
	require_env
	local page=1 batch n released tag
	released=$(mktemp)
	cmd_list | cut -f2 | sort -u > "$released"

	while :; do
		batch=$(curl --fail -sS "${AUTH[@]}" "${API}/tags?per_page=100&page=${page}")
		n=$(jq 'length' <<<"$batch")
		if [ "$n" -eq 0 ]; then break; fi
		while read -r tag; do
			if [ -z "$tag" ]; then continue; fi
			case "$tag" in
				*-pr.* | *-rc.*)
					if ! grep -qxF "$tag" "$released"; then
						printf -- '-\t%s\n' "$tag"
					fi
					;;
			esac
		done < <(jq -r '.[].name' <<<"$batch")
		if [ "$n" -lt 100 ]; then break; fi
		page=$((page + 1))
	done
}

cmd_orphans() {
	require_env
	local stable id tag pr state base note
	# Highest stable release, by numeric version rather than publish order.
	stable=$(gh release list --limit 100 --json tagName,isPrerelease \
		--jq '[.[] | select(.isPrerelease==false) | .tagName | ltrimstr("v")]
		      | sort_by(split(".") | map(tonumber? // 0)) | last')
	stable="${stable:-0.0.0}"
	echo "current stable: ${stable}" >&2

	# Both sources classify identically: a release-less tag is just as orphaned
	# as its release would have been, and must not survive on a technicality.
	while IFS=$'\t' read -r id tag; do
		if [ -z "$tag" ]; then continue; fi
		if [ "$id" = "-" ]; then note=" [tag only]"; else note=""; fi
		case "$tag" in
			# PR preview: the PR's own state is authoritative, so a preview
			# outlives exactly as long as its PR is open. State-based, so a
			# missed close event self-heals on the next run.
			*-pr.*)
				pr=$(preview_pr_number "$tag")
				state=$(gh api "repos/${GH_REPO}/pulls/${pr}" --jq .state 2>/dev/null || echo "missing")
				if [ "$state" = "open" ]; then
					echo "keep    ${tag} (PR #${pr} open)${note}" >&2
				else
					echo "orphan  ${tag} (PR #${pr} ${state})${note}" >&2
					printf '%s\t%s\n' "$id" "$tag"
				fi
				;;
			# Legacy hand-cut RC from the retired pre-1.13 scheme. Spent once
			# stable reaches its base version; an RC for an unreleased version
			# is left alone so reviving the scheme does not self-destruct.
			*-rc.*)
				base=${tag%%-rc.*}
				base=${base#v}
				if version_superseded "$base" "$stable"; then
					echo "orphan  ${tag} (superseded by stable ${stable})${note}" >&2
					printf '%s\t%s\n' "$id" "$tag"
				else
					echo "keep    ${tag} (ahead of stable ${stable})${note}" >&2
				fi
				;;
			*)
				echo "keep    ${tag} (unrecognised prerelease shape)${note}" >&2
				;;
		esac
	done < <(cmd_list; cmd_release_less_tags)
}

cmd_delete() {
	require_env
	# Buffer stdin: callers pipe from `list`/`orphans`, and deleting while that
	# paginated read is still in flight shifts later pages out from under it.
	local pending count id tag code
	pending=$(mktemp)
	cat > "$pending"
	count=$(grep -c . "$pending" || true)

	if [ "$count" -eq 0 ]; then
		echo "nothing to delete"
		return 0
	fi
	if [ "${DRY_RUN:-0}" = "1" ]; then
		echo "DRY RUN: would delete ${count} prerelease(s):"
		cut -f2 "$pending" | sed 's/^/  /'
		return 0
	fi

	while IFS=$'\t' read -r id tag; do
		if [ -z "$tag" ]; then continue; fi
		# id "-" means the tag has no release (see release-less-tags): there is
		# nothing to DELETE on the releases endpoint, only the ref below.
		if [ "$id" != "-" ]; then
			curl --fail -sS -X DELETE "${AUTH[@]}" "${API}/releases/${id}" > /dev/null
		fi
		# The tag can legitimately already be gone (a release deleted by hand
		# leaves none), so 404/422 is success here; anything else is real and
		# must not be swallowed.
		code=$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE \
			"${AUTH[@]}" "${API}/git/refs/tags/${tag}")
		case "$code" in
			2* | 404 | 422) ;;
			*)
				echo "::error::deleting tag ${tag} returned HTTP ${code}"
				exit 1
				;;
		esac
		echo "deleted ${tag}"
	done < "$pending"
	echo "removed ${count} prerelease(s)"
}

cmd_selftest() {
	local fails=0
	check() { # check <desc> <expected: yes|no> <base> <stable>
		local want="$2" got="no"
		if version_superseded "$3" "$4"; then got="yes"; fi
		if [ "$got" != "$want" ]; then
			echo "FAIL: $1 (want ${want}, got ${got})"
			fails=$((fails + 1))
		fi
	}
	# The lexical traps are the whole reason this is a numeric compare.
	check "1.9.26 is spent under 1.20.1" yes 1.9.26 1.20.1
	check "1.2.0 is spent under 1.20.1" yes 1.2.0 1.20.1
	check "an RC for the current stable is spent" yes 1.20.1 1.20.1
	check "1.21.0 RC survives 1.20.1" no 1.21.0 1.20.1
	check "1.20.2 RC survives 1.20.1" no 1.20.2 1.20.1
	check "2.0.0 RC survives 1.20.1" no 2.0.0 1.20.1

	local n
	n=$(preview_pr_number "1.18.2-pr.341.g7e6e1d8")
	if [ "$n" != "341" ]; then
		echo "FAIL: pr number from sha-suffixed tag (got ${n})"
		fails=$((fails + 1))
	fi
	n=$(preview_pr_number "1.18.2-pr.341")
	if [ "$n" != "341" ]; then
		echo "FAIL: pr number from bare tag (got ${n})"
		fails=$((fails + 1))
	fi

	# The PR-number boundary: a prefix match would let #35 delete #354's
	# preview. This regressed once already when the filter went through
	# `awk -v`, which unescaped the guard away.
	local fixture got
	fixture=$(printf '1\t1.18.2-pr.35.gaaa\n2\t1.18.2-pr.354.gbbb\n3\t1.18.2-pr.3.gccc\n4\t1.3.1-rc.1\n5\t1.18.2-pr.354\n')
	got=$(filter_pr 35 <<<"$fixture" | cut -f2 | paste -sd, -)
	if [ "$got" != "1.18.2-pr.35.gaaa" ]; then
		echo "FAIL: filter_pr 35 matched '${got}' (must not touch 354 or 3)"
		fails=$((fails + 1))
	fi
	got=$(filter_pr 354 <<<"$fixture" | cut -f2 | paste -sd, -)
	if [ "$got" != "1.18.2-pr.354.gbbb,1.18.2-pr.354" ]; then
		echo "FAIL: filter_pr 354 matched '${got}' (want both sha and bare forms)"
		fails=$((fails + 1))
	fi
	got=$(filter_pr 354 "1.18.2-pr.354.gbbb" <<<"$fixture" | cut -f2 | paste -sd, -)
	if [ "$got" != "1.18.2-pr.354" ]; then
		echo "FAIL: filter_pr with keep matched '${got}' (keep tag must survive)"
		fails=$((fails + 1))
	fi
	# A non-preview tag must never be selected by a PR filter, whatever the number.
	got=$(filter_pr 1 <<<"$fixture" | cut -f2 | paste -sd, -)
	if [ -n "$got" ]; then
		echo "FAIL: filter_pr 1 matched non-preview tag(s) '${got}'"
		fails=$((fails + 1))
	fi

	if [ "$fails" -ne 0 ]; then
		echo "${fails} selftest failure(s)"
		exit 1
	fi
	echo "selftest OK"
}

case "${1:-}" in
	list) cmd_list ;;
	orphans) cmd_orphans ;;
	for-pr) cmd_for_pr "${2:-}" "${3:-}" ;;
	release-less-tags) cmd_release_less_tags ;;
	delete) cmd_delete ;;
	selftest) cmd_selftest ;;
	*)
		echo "usage: $0 {list|orphans|for-pr <n> [keep-tag]|release-less-tags|delete|selftest}" >&2
		exit 2
		;;
esac
