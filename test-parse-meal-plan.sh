#!/bin/bash
# =========================================================
# SAVIA: test-parse-meal-plan.sh
# Testea la Edge Function parse-meal-plan con tu plan real.
#
# USO:
#   1) Tocá tu cuenta SAVIA en https://usesavia.com en Chrome/Safari
#   2) Abrí DevTools (Cmd+Option+I) → Console
#   3) Pegá esto en la consola y dale Enter (copia tu JWT al portapapeles):
#        copy((await window.sb.auth.getSession()).data.session.access_token)
#   4) En Terminal, en la carpeta del proyecto, corré:
#        ./test-parse-meal-plan.sh "ruta/al/plan.pdf"
#   5) Cuando te pida el JWT, pegá (Cmd+V) y Enter
# =========================================================

set -e

PDF_PATH="$1"
if [ -z "$PDF_PATH" ]; then
  echo "❌ Uso: $0 ruta/al/plan.pdf"
  echo ""
  echo "Ejemplo: $0 ~/Downloads/plan_sofia.pdf"
  exit 1
fi

if [ ! -f "$PDF_PATH" ]; then
  echo "❌ No existe el archivo: $PDF_PATH"
  exit 1
fi

# Detectar mime type por extensión
EXT_LOWER=$(echo "${PDF_PATH##*.}" | tr '[:upper:]' '[:lower:]')
case "$EXT_LOWER" in
  pdf)        MIME="application/pdf" ;;
  jpg|jpeg)   MIME="image/jpeg" ;;
  png)        MIME="image/png" ;;
  webp)       MIME="image/webp" ;;
  *)
    echo "❌ Extensión no soportada: $EXT_LOWER (uso: pdf, jpg, jpeg, png, webp)"
    exit 1
    ;;
esac

# Extraer SUPABASE_URL y ANON_KEY de onboarding.html
HTML_FILE="$(dirname "$0")/onboarding.html"
if [ ! -f "$HTML_FILE" ]; then
  echo "❌ No encuentro onboarding.html en $(dirname "$0")"
  exit 1
fi

SUPABASE_URL=$(grep -E "const SUPABASE_URL\s*=" "$HTML_FILE" | head -1 | sed -E "s/.*'([^']+)'.*/\1/")
ANON_KEY=$(grep -E "const SUPABASE_ANON_KEY\s*=" "$HTML_FILE" | head -1 | sed -E "s/.*'([^']+)'.*/\1/")

if [ -z "$SUPABASE_URL" ] || [ -z "$ANON_KEY" ]; then
  echo "❌ No pude extraer SUPABASE_URL o SUPABASE_ANON_KEY de onboarding.html"
  exit 1
fi

echo "✓ SUPABASE_URL: $SUPABASE_URL"
echo "✓ Archivo: $PDF_PATH ($MIME)"
echo ""
echo "📋 Buscando JWT..."
echo ""

JWT=""

# Opción 1: archivo descargado (más confiable que clipboard)
if [ -f "$HOME/Downloads/savia-jwt.txt" ]; then
  JWT=$(cat "$HOME/Downloads/savia-jwt.txt" | tr -d '\n\r ')
  if [[ "$JWT" =~ ^eyJ ]] && [ ${#JWT} -ge 200 ]; then
    echo "✓ JWT leído de ~/Downloads/savia-jwt.txt (${#JWT} chars)"
    # Borrar el archivo después de usarlo (seguridad)
    rm "$HOME/Downloads/savia-jwt.txt"
  else
    JWT=""
  fi
fi

# Opción 2: fallback al clipboard
if [ -z "$JWT" ]; then
  CLIP=$(pbpaste | tr -d '\n\r ')
  if [[ "$CLIP" =~ ^eyJ ]] && [ ${#CLIP} -ge 200 ]; then
    JWT="$CLIP"
    echo "✓ JWT leído del portapapeles (${#JWT} chars)"
  fi
fi

if [ -z "$JWT" ]; then
  echo "❌ No encontré JWT válido."
  echo ""
  echo "   En Safari → DevTools → Console, pegá esto:"
  echo ""
  echo "   let t = JSON.parse(localStorage.getItem('sb-vlzzgttjrpyywmahwooi-auth-token')).access_token;"
  echo "   let a = document.createElement('a');"
  echo "   a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(t);"
  echo "   a.download = 'savia-jwt.txt';"
  echo "   a.click();"
  echo ""
  echo "   Eso descarga el JWT como archivo a ~/Downloads/savia-jwt.txt"
  echo "   Después volvé a correr este script."
  exit 1
fi

echo ""

echo ""
echo "📦 Codificando archivo a base64..."
BASE64=$(base64 -i "$PDF_PATH" | tr -d '\n')
SIZE_KB=$((${#BASE64} / 1024))
echo "   Tamaño base64: ${SIZE_KB}KB"

if [ $SIZE_KB -gt 11500 ]; then
  echo "❌ Archivo demasiado grande (>11.5MB). Reducí la calidad."
  exit 1
fi

echo ""
echo "✨ Llamando a parse-meal-plan..."
echo "   (Esto tarda ~10-20 segundos)"
echo ""

START_TIME=$(date +%s)

RESPONSE=$(curl -sS -X POST "$SUPABASE_URL/functions/v1/parse-meal-plan" \
  -H "Authorization: Bearer $JWT" \
  -H "apikey: $ANON_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @<(printf '{"file":"%s","mime":"%s"}' "$BASE64" "$MIME"))

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

echo "⏱  Tardó ${ELAPSED}s"
echo ""
echo "════════════════════════════════════════════"
echo "  RESULTADO"
echo "════════════════════════════════════════════"
echo ""

# Pretty print con Python (siempre disponible en Mac)
echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"

echo ""
echo "════════════════════════════════════════════"

# Resumen rápido si la respuesta es válida
ERROR=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null || echo "")
if [ -n "$ERROR" ]; then
  echo "❌ Error: $ERROR"
else
  KCAL=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['targets'].get('kcal',''))" 2>/dev/null || echo "?")
  NUM_MEALS=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('meals',[])))" 2>/dev/null || echo "?")
  NUM_SUPS=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('supplements',[])))" 2>/dev/null || echo "?")
  NUM_RULES=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('rules',[])))" 2>/dev/null || echo "?")
  NUTRI=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['nutritionist'].get('name',''))" 2>/dev/null || echo "?")

  echo "✓ Nutricionista: $NUTRI"
  echo "✓ Total: $KCAL kcal"
  echo "✓ Comidas detectadas: $NUM_MEALS"
  echo "✓ Suplementos detectados: $NUM_SUPS"
  echo "✓ Reglas detectadas: $NUM_RULES"
fi
echo ""
