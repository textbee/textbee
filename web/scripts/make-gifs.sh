#!/usr/bin/env bash
# Convert the .webm videos recorded by e2e/record.spec.ts into README GIFs and
# 1080p mp4 clips. Run the recording first:
#   pnpm exec playwright test e2e/record.spec.ts
#   OUT_DIR=/path/to/assets bash scripts/make-gifs.sh
set -euo pipefail

RESULTS_DIR="${RESULTS_DIR:-test-results}"
OUT_DIR="${OUT_DIR:-.screenshots/motion}"
GIF_W="${GIF_W:-1200}"
FPS="${FPS:-15}"
# Recording starts at context creation, before the first navigation, so the
# opening ~0.8s is a blank page. Trim it so the GIF loops on real content.
START="${START:-0.8}"

mkdir -p "$OUT_DIR"

# name -> path substring that identifies its test-results folder.
convert() {
  local name="$1" match="$2"
  local webm
  webm="$(find "$RESULTS_DIR" -path "*${match}*" -name '*.webm' | head -1 || true)"
  if [ -z "$webm" ]; then
    echo "skip $name: no .webm matching *${match}*"
    return
  fi
  echo "==> $name  <-  $webm"

  # 1080p mp4 (H.264, faststart for web/YouTube).
  ffmpeg -y -loglevel error -ss "$START" -i "$webm" \
    -vf "scale=1920:1080:flags=lanczos,format=yuv420p" \
    -c:v libx264 -crf 20 -preset slow -movflags +faststart \
    "$OUT_DIR/${name}.mp4"

  # High-quality looping GIF (two-pass palette).
  local pal="$OUT_DIR/.${name}-palette.png"
  ffmpeg -y -loglevel error -ss "$START" -i "$webm" \
    -vf "fps=${FPS},scale=${GIF_W}:-1:flags=lanczos,palettegen=stats_mode=diff" "$pal"
  ffmpeg -y -loglevel error -ss "$START" -i "$webm" -i "$pal" \
    -lavfi "fps=${FPS},scale=${GIF_W}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3" \
    "$OUT_DIR/${name}.gif"
  rm -f "$pal"

  echo "    mp4 $(du -h "$OUT_DIR/${name}.mp4" | cut -f1)  gif $(du -h "$OUT_DIR/${name}.gif" | cut -f1)"
}

convert "send-sms" "send-sms"
convert "dashboard-tour" "tour"

echo "done -> $OUT_DIR"
