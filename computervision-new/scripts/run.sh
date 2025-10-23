#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"

# Les privat .env ved siden av scriptet
if [[ -f "$SCRIPT_DIR/.env" ]]; then
  set -a
  source "$SCRIPT_DIR/.env"
  set +a
else
  echo "Mangler $SCRIPT_DIR/.env. Kopiér .env.example -> .env og fyll inn verdier."
  exit 1
fi

# Valgfritt: gå til prosjektroten (mappa som inneholder package.json)
cd "$SCRIPT_DIR/.."

# Start Expo
npx expo start -c --tunnel