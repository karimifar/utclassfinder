#!/usr/bin/env bash
# Builds the iOS app on EAS for TestFlight, then offers to submit it.
#
# The build number lives in ios/UTClassFinder/Info.plist (CFBundleVersion) and
# always holds the number the *next* build will use. This script only moves it
# once a build has succeeded, so a failed build costs nothing: fix the problem,
# run again, and the retry ships under the same number. (With EAS counting
# remotely, every attempt took a number and failures left gaps — 8 and 10.)
#
# On success: tags the built commit ios-b<N>, commits the plist bumped to N+1,
# pushes both, and asks whether to submit. Submission is interactive — it signs
# in with the Apple ID and its app-specific password.
#
# Run: npm run release:ios
set -euo pipefail
cd "$(dirname "$0")/.."

PLIST=ios/UTClassFinder/Info.plist
plist() { /usr/libexec/PlistBuddy -c "$1" "$PLIST"; }
die() { echo "release-ios: $*" >&2; exit 1; }

# EAS builds what is committed, so what ships has to be exactly what is pushed.
[[ -z $(git status --porcelain) ]] || die "uncommitted changes — commit or stash them first"
branch=$(git rev-parse --abbrev-ref HEAD)
git fetch -q origin
[[ $(git rev-parse HEAD) == $(git rev-parse "origin/$branch" 2>/dev/null) ]] \
  || die "$branch is not in sync with origin — push (or pull) first"

build=$(plist 'Print :CFBundleVersion')
version=$(plist 'Print :CFBundleShortVersionString')
[[ $build =~ ^[0-9]+$ ]] || die "CFBundleVersion is '$build', expected a whole number"
grep -q "version: '$version'" app.config.js \
  || die "Info.plist says $version but app.config.js disagrees — bump both"
if git rev-parse -q --verify "refs/tags/ios-b$build" >/dev/null; then
  die "ios-b$build already exists, so build $build has shipped — CFBundleVersion should be the next number"
fi

commit=$(git rev-parse --short HEAD)
echo "Building $version ($build) from $commit on $branch — this takes about 10 minutes."
out=$(eas build -p ios -e testflight --non-interactive --wait --json) || true
id=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])[0]["id"])' "$out" 2>/dev/null || true)
status=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])[0]["status"])' "$out" 2>/dev/null || true)

if [[ $status != FINISHED ]]; then
  echo
  echo "Build ${status:-failed}. Nothing was tagged or bumped: fix it and run again —"
  echo "the retry will reuse build number $build."
  [[ -n $id ]] && echo "Logs: https://expo.dev/accounts/karimifar/projects/utclassfinder/builds/$id"
  exit 1
fi

git tag -a "ios-b$build" HEAD -m "TestFlight build $build ($version)"
# Edited in place rather than with PlistBuddy, which rewrites the whole file —
# reindenting it and dropping the comments in it.
perl -0pi -e "s|(<key>CFBundleVersion</key>\\s*<string>)$build(</string>)|\${1}$((build + 1))\${2}|" "$PLIST"
[[ $(plist 'Print :CFBundleVersion') == $((build + 1)) ]] || die "could not bump CFBundleVersion in $PLIST"
git commit -q -m "Next iOS build is $((build + 1))" -- "$PLIST"
git push -q origin HEAD "ios-b$build"
echo
echo "Built $version ($build), tagged ios-b$build. Info.plist now holds $((build + 1)) for the next one."

read -r -p "Submit build $build to TestFlight now? [y/N] " answer
if [[ $answer =~ ^[Yy] ]]; then
  # EAS signs in to App Store Connect with this instead of a full Apple login.
  # Read silently so it never lands in shell history.
  if [[ -z ${EXPO_APPLE_APP_SPECIFIC_PASSWORD:-} ]]; then
    read -r -s -p "App-specific password: " EXPO_APPLE_APP_SPECIFIC_PASSWORD
    echo
    export EXPO_APPLE_APP_SPECIFIC_PASSWORD
  fi
  eas submit -p ios --profile testflight --id "$id"
else
  echo "Later: EXPO_APPLE_APP_SPECIFIC_PASSWORD=… eas submit -p ios --profile testflight --id $id"
fi
