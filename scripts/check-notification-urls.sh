#!/usr/bin/env bash
# The addresses notifications, installing and app links depend on (ROADMAP
# 18.7), checked over HTTP against a running site — production, or a local
# production build. It reads each host the way a browser, Apple or Google
# would: no cookies, no following redirects.
#
#   scripts/check-notification-urls.sh <scheme> <root-domain> <shop-slug> [--app] [--custom-domain <host>]
#
#   scheme         https for the live site, http for a local build
#   root-domain    e.g. getnotely.io, or app.localhost:3100 locally
#   shop-slug      a live shop (its admin host and its shop- host are checked)
#   --app          the shop has a store app with its links recorded (18.5):
#                  check both well-known files serve it
#   --custom-domain <host>
#                  the shop's own domain: its pages must redirect from the
#                  platform address, but the well-known files must not
#   --platform-host <host>
#                  where sign-in and the console live (NEXT_PUBLIC_PLATFORM_HOST).
#                  Default: app.<root-domain> — as in production — or the root
#                  domain itself for a local *.localhost build
#   OWN_DOMAIN_REACHABLE=0 (environment) skips requests to the own domain
#                  itself — for a local build, where it doesn't resolve
#
# e.g. scripts/check-notification-urls.sh https getnotely.io pynacode --app
set -uo pipefail

SCHEME=${1:?scheme}; ROOT=${2:?root domain}; SLUG=${3:?shop slug}; shift 3
APP=0; CUSTOM=""; PLATFORM=""
while [ $# -gt 0 ]; do
  case "$1" in
    --app) APP=1 ;;
    --custom-domain) CUSTOM=$2; shift ;;
    --platform-host) PLATFORM=$2; shift ;;
  esac
  shift
done

ADMIN="$SLUG.$ROOT"
SHOP="shop-$SLUG.$ROOT"
# The bare domain is the public site (and often redirects to www); the
# console is on the platform host.
if [ -z "$PLATFORM" ]; then
  case "$ROOT" in *localhost*) PLATFORM="$ROOT" ;; *) PLATFORM="app.$ROOT" ;; esac
fi
FAILED=0

# status and content type of one address, without following redirects
probe() { curl -s -o /dev/null -w '%{http_code} %{content_type} %{redirect_url}' --max-time 20 "$SCHEME://$1$2"; }

expect() { # host path wanted-status wanted-type-or-location-fragment what
  local got; got=$(probe "$1" "$2")
  local status=${got%% *}
  if [ "$status" = "$3" ] && [[ "$got" == *"$4"* ]]; then
    printf '  ✓ %s\n' "$5"
  else
    printf '  ✗ %s — %s%s gave %s (wanted %s, %s)\n' "$5" "$1" "$2" "$got" "$3" "$4"
    FAILED=1
  fi
}

echo "The service worker, on every kind of host"
expect "$ADMIN" /sw.js 200 javascript 'admin host serves /sw.js'
expect "$SHOP" /sw.js 200 javascript 'shop host serves /sw.js'
expect "$PLATFORM" /sw.js 200 javascript 'platform host serves /sw.js'

echo "Installing, without a session"
expect "$ADMIN" /manifest.webmanifest 200 manifest+json "admin manifest loads signed out"
expect "$ADMIN" /app-icon/192 200 image/png 'admin icon loads signed out'
expect "$PLATFORM" /platform/manifest.webmanifest 200 manifest+json 'console manifest loads signed out'
expect "$PLATFORM" /platform/app-icon/512 200 image/png 'console icon loads signed out'
if [ -z "$CUSTOM" ]; then
  expect "$SHOP" /manifest.webmanifest 200 manifest+json "shop manifest loads"
  expect "$SHOP" /app-icon/192 200 image/png 'shop icon loads'
fi

echo "…and nothing else does"
expect "$ADMIN" /notifications 307 /login 'admin pages still need sign-in'
expect "$PLATFORM" /platform/notifications 307 /login 'console pages still need sign-in'

if [ -n "$CUSTOM" ]; then
  echo "The shop's own domain"
  expect "$SHOP" /products 308 "$CUSTOM" 'pages on the platform address go to the own domain'
fi

if [ "$APP" = 1 ]; then
  echo "Store links open the app — served at the exact address, never redirected"
  expect "$SHOP" /.well-known/apple-app-site-association 200 application/json 'iPhone file on the platform address'
  expect "$SHOP" /.well-known/assetlinks.json 200 application/json 'Android file on the platform address'
  if [ -n "$CUSTOM" ] && [ "${OWN_DOMAIN_REACHABLE:-1}" = 1 ]; then
    expect "$CUSTOM" /.well-known/apple-app-site-association 200 application/json 'iPhone file on the own domain'
    expect "$CUSTOM" /.well-known/assetlinks.json 200 application/json 'Android file on the own domain'
  fi
fi

if [ "$FAILED" = 0 ]; then echo "All good."; else echo "Some checks failed — see ✗ above."; fi
exit $FAILED
