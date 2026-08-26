#!/usr/bin/env bash
set -euo pipefail
if [[ "${EUID}" -ne 0 ]]; then echo '{"ready":false,"code":"PREFLIGHT_REQUIRES_ROOT"}'; exit 1; fi
expected=$'assemblyai-api-key\ndatabase-url\ngoogle-oauth-client-secret\ngoogle-oauth-keyring.json\ninternal-service-tokens.json\nrouterai-api-key\ntelegram-bot-token\ntelegram-recipients.json'
actual="$(find /etc/hh-agent/credentials -mindepth 1 -maxdepth 1 -type f -printf '%f\n' | sort)"
[[ "${actual}" == "${expected}" ]] || { echo '{"ready":false,"code":"CREDENTIAL_ALLOWLIST_MISMATCH"}'; exit 1; }
if find /etc/hh-agent/credentials \( -type l -o -type f -perm /023 \) | grep -q .; then echo '{"ready":false,"code":"CREDENTIAL_PERMISSION_UNSAFE"}'; exit 1; fi
if ss -ltn | awk '{print $4}' | grep -E '(^|:)(5432|4311|4312)$' | grep -Ev '^(127\.0\.0\.1|\[::1\]):' | grep -q .; then echo '{"ready":false,"code":"PRIVATE_PORT_PUBLIC"}'; exit 1; fi
runtime_file=/etc/hh-agent/runtime.env
app_origin="$(sed -n 's/^APP_ORIGIN=//p' "${runtime_file}")"
redirect_uri="$(sed -n 's/^GOOGLE_OAUTH_REDIRECT_URI=//p' "${runtime_file}")"
auth_mode="$(sed -n 's/^AUTH_MODE=//p' "${runtime_file}")"
e2e_environment="$(sed -n 's/^E2E_ENVIRONMENT=//p' "${runtime_file}")"
[[ "${auth_mode}" == 'postgres-password' ]] || { echo '{"ready":false,"code":"AUTH_MODE_NOT_READY"}'; exit 1; }
[[ "${e2e_environment}" == 'production' ]] || { echo '{"ready":false,"code":"PRODUCTION_TEST_BYPASS_REJECTED"}'; exit 1; }
if grep -Eq '^LOCAL_AUTH_USER_(ID|EMAIL|FULL_NAME)=.+' "${runtime_file}"; then echo '{"ready":false,"code":"PRODUCTION_TEST_IDENTITY_BYPASS_REJECTED"}'; exit 1; fi
[[ "${app_origin}" =~ ^https://[A-Za-z0-9.-]+$ && "${app_origin}" != 'https://hire.example.com' ]] || { echo '{"ready":false,"code":"PUBLIC_ORIGIN_NOT_CONFIGURED"}'; exit 1; }
[[ "${redirect_uri}" == "${app_origin}/api/integrations/google-drive/oauth/callback" ]] || { echo '{"ready":false,"code":"GOOGLE_REDIRECT_ORIGIN_MISMATCH"}'; exit 1; }
if grep -Eq '=replace-with-|hire\.example\.com' "${runtime_file}"; then echo '{"ready":false,"code":"RUNTIME_PLACEHOLDER_REMAINS"}'; exit 1; fi
ln -sfn /etc/nginx/sites-available/hh-web /etc/nginx/sites-enabled/hh-web
nginx -t >/dev/null 2>&1 || { echo '{"ready":false,"code":"NGINX_TLS_OR_CONFIG_INVALID"}'; exit 1; }
if grep -Eq 'auth_basic|oai-authenticated-user-id[[:space:]]+"[^" ]+' /etc/nginx/sites-enabled/hh-web; then echo '{"ready":false,"code":"NGINX_LEGACY_AUTH_PRESENT"}'; exit 1; fi
cd /opt/hh-agent/current/web
sudo -u hh-agent env HH_RUNTIME_CONFIG_ROOT=/etc/hh-agent npm run preflight:runtime
