#!/bin/bash
# Generate release notes for Python releases
# Usage: ./generate-python-release-notes.sh <version> <prev_tag> <mode>
# mode: "draft" or "publish"

set -euo pipefail

VERSION="${1:-}"
PREV_TAG="${2:-none}"
MODE="${3:-publish}"
REPO_URL="https://github.com/mcp-use/mcp-use"
REPO_SLUG="mcp-use/mcp-use"

TMP_ITEMS="/tmp/python_release_items_$$.tsv"
TMP_FEATURES="/tmp/python_release_features_$$.tsv"
TMP_FIXES="/tmp/python_release_fixes_$$.tsv"
TMP_OTHERS="/tmp/python_release_others_$$.tsv"

cleanup() {
  rm -f "$TMP_ITEMS" "$TMP_FEATURES" "$TMP_FIXES" "$TMP_OTHERS"
}
trap cleanup EXIT

can_use_gh() {
  # Avoid `gh auth status` here: it can block in some environments (e.g. interactive auth/keychain).
  # Instead, only enable `gh pr view` when a token is available.
  command -v gh >/dev/null 2>&1 && { [ -n "${GH_TOKEN:-}" ] || [ -n "${GITHUB_TOKEN:-}" ]; }
}

extract_login_from_email() {
  local email="${1:-}"
  if [[ "$email" =~ ^[0-9]+\+(.+)@users\.noreply\.github\.com$ ]]; then
    echo "${BASH_REMATCH[1]}"
    return
  fi
  if [[ "$email" =~ ^(.+)@users\.noreply\.github\.com$ ]]; then
    echo "${BASH_REMATCH[1]}"
    return
  fi
  echo "${email%%@*}"
}

contains_python_ci() {
  local s="${1:-}"
  local lc
  lc="$(printf '%s' "$s" | tr '[:upper:]' '[:lower:]')"
  [[ "$lc" == *python* ]]
}

classify_title() {
  # Classify by keywords (case-insensitive) in the title:
  # - Bug Fixes: contains "fix"
  # - Features: contains "feat" or "feature"
  # - Other: everything else
  local title="${1:-}"
  local lc
  lc="$(printf '%s' "$title" | tr '[:upper:]' '[:lower:]')"

  if [[ "$lc" == *fix* ]]; then
    echo "fix"
    return
  fi
  if [[ "$lc" == *feat* ]] || [[ "$lc" == *feature* ]]; then
    echo "feature"
    return
  fi
  echo "other"
}

if [ "$MODE" = "draft" ]; then
  echo "## Draft Release"
  echo ""
  echo "**This is a draft release tracking changes since ${PREV_TAG/python-v/v}.**"
  echo ""
else
  echo "## What's Changed"
  echo ""
fi

# Determine range
if [ "$PREV_TAG" = "none" ]; then
  RANGE=""
else
  RANGE="$PREV_TAG..HEAD"
fi

# Build items list (TSV) in git-log order.
# Columns: kind<TAB>class<TAB>title<TAB>author<TAB>url_or_dash<TAB>sha
USE_GH="false"
if can_use_gh; then
  USE_GH="true"
fi

git log --pretty=format:$'%H\t%s\t%ae\t%an' $RANGE | while IFS=$'\t' read -r SHA SUBJECT EMAIL AUTHOR_NAME; do
  PR_NUMBER=""
  if [[ "$SUBJECT" =~ \(\#([0-9]+)\) ]]; then
    PR_NUMBER="${BASH_REMATCH[1]}"
  elif [[ "$SUBJECT" =~ Merge\ pull\ request\ \#([0-9]+) ]]; then
    PR_NUMBER="${BASH_REMATCH[1]}"
  fi

  if [ -n "$PR_NUMBER" ] && [ "$USE_GH" = "true" ]; then
    # Use GitHub PR metadata for correct title + author login
    PR_TSV="$(gh pr view "$PR_NUMBER" --repo "$REPO_SLUG" --json title,author,url -q $'.title + \"\\t\" + .author.login + \"\\t\" + .url' 2>/dev/null || true)"
    if [ -n "$PR_TSV" ]; then
      PR_TITLE="$(printf '%s' "$PR_TSV" | cut -f1)"
      PR_LOGIN="$(printf '%s' "$PR_TSV" | cut -f2)"
      PR_URL="$(printf '%s' "$PR_TSV" | cut -f3)"

      if contains_python_ci "$PR_TITLE"; then
        CLASS="$(classify_title "$PR_TITLE")"
        printf "pr\t%s\t%s\t%s\t%s\t%s\n" "$CLASS" "$PR_TITLE" "$PR_LOGIN" "$PR_URL" "$SHA" >> "$TMP_ITEMS"
      fi
      continue
    fi
    # If gh fails, fall through to subject-based filtering below
  fi

  # Non-PR commit (or PR metadata unavailable): filter on subject only
  if ! contains_python_ci "$SUBJECT"; then
    continue
  fi

  CLEAN_SUBJECT="$(printf '%s' "$SUBJECT" | sed -E 's/ *\(\#[0-9]+\) *$//')"
  if [ -n "$PR_NUMBER" ]; then
    # Best-effort PR attribution without GitHub metadata
    LOGIN="$(extract_login_from_email "$EMAIL")"
    if [ -z "$LOGIN" ]; then
      LOGIN="$AUTHOR_NAME"
    fi
    CLASS="$(classify_title "$CLEAN_SUBJECT")"
    printf "pr\t%s\t%s\t%s\t%s\t%s\n" "$CLASS" "$CLEAN_SUBJECT" "$LOGIN" "$REPO_URL/pull/$PR_NUMBER" "$SHA" >> "$TMP_ITEMS"
  else
    # Commit attribution: use the commit author name (not necessarily a GitHub handle)
    CLASS="$(classify_title "$CLEAN_SUBJECT")"
    printf "commit\t%s\t%s\t%s\t-\t%s\n" "$CLASS" "$CLEAN_SUBJECT" "$AUTHOR_NAME" "$SHA" >> "$TMP_ITEMS"
  fi
done

# Split items into categories (preserve original git-log order within each category)
if [ -s "$TMP_ITEMS" ]; then
  while IFS=$'\t' read -r KIND CLASS TITLE AUTHOR URL SHA; do
    case "$CLASS" in
      fix) printf "%s\t%s\t%s\t%s\t%s\t%s\n" "$KIND" "$CLASS" "$TITLE" "$AUTHOR" "$URL" "$SHA" >> "$TMP_FIXES" ;;
      feature) printf "%s\t%s\t%s\t%s\t%s\t%s\n" "$KIND" "$CLASS" "$TITLE" "$AUTHOR" "$URL" "$SHA" >> "$TMP_FEATURES" ;;
      *) printf "%s\t%s\t%s\t%s\t%s\t%s\n" "$KIND" "$CLASS" "$TITLE" "$AUTHOR" "$URL" "$SHA" >> "$TMP_OTHERS" ;;
    esac
  done < "$TMP_ITEMS"

  emit_section() {
    local header="${1:-}"
    local file="${2:-}"
    if [ -s "$file" ]; then
      echo "### $header"
      echo ""
      while IFS=$'\t' read -r KIND _CLASS TITLE AUTHOR URL SHA; do
        SHORT_SHA="${SHA:0:7}"
        if [ "$KIND" = "pr" ]; then
          echo "* $TITLE by @$AUTHOR in $URL"
        else
          echo "* $TITLE (\`$SHORT_SHA\`)"
        fi
      done < "$file"
      echo ""
    fi
  }

  emit_section "Features" "$TMP_FEATURES"
  emit_section "Bug Fixes" "$TMP_FIXES"
  emit_section "Other" "$TMP_OTHERS"

  echo "Huge thanks to the contributors of this release!"
  echo ""
else
  if [ "$MODE" = "draft" ]; then
    echo "No commits with 'python' in the title found since last release."
    echo ""
  fi
fi

# Add full changelog link if not draft and we have a previous tag
if [ "$MODE" != "draft" ] && [ "$PREV_TAG" != "none" ]; then
  echo "**Full Changelog**: $REPO_URL/compare/$PREV_TAG...python-v$VERSION"
fi
