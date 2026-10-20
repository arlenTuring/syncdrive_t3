#!/usr/bin/env bash
# 本機影像管線測試用的「合成攝影機」：一個獨立的 MediaMTX 容器（模擬區網攝影機，RTSP 18554），
# 由 ffmpeg 推送 N 路測試畫面（含時間戳），每路有時間上限，跑完自動停止。只供開發／整合測試。
# 開發機與 GCP 主機都可用（GCP 上主機沒有 ffmpeg 時改在攝影機容器內推流）；攝影機帳密只給測試用。
#
#   scripts/video-test-cameras.sh start [路數=2] [秒數=600] [密碼]
#   scripts/video-test-cameras.sh stop
#
# 攝影機位址：rtsp://cam:<密碼>@<本機區網 IP>:18554/cam1 … camN（本機區網 IP 需在「影像連線範圍」內）
set -euo pipefail
export PATH="$PATH:/Applications/Docker.app/Contents/Resources/bin"
NAME=vtms_test_cameras
IMAGE="bluenviron/mediamtx:1.21.2-ffmpeg@sha256:c0feb4acc548d5f410d57d9046f62dfa355e2abc4098f5243de9e86430c77a95"
cmd="${1:-start}"
if [ "$cmd" = stop ]; then
  pkill -f "rtsp://cam:.*@127.0.0.1:18554/cam" 2>/dev/null || true
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  echo "已停止測試攝影機"
  exit 0
fi
count="${2:-2}"; seconds="${3:-600}"; pass="${4:-camtest}"
[ "$count" -ge 1 ] && [ "$count" -le 12 ] || { echo "路數 1–12" >&2; exit 1; }
[ "$seconds" -le 7200 ] || { echo "最長 7200 秒" >&2; exit 1; }
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -p 18554:8554 \
  -e MTX_AUTHMETHOD=internal \
  -e MTX_RTMP=no -e MTX_HLS=no -e MTX_WEBRTC=no -e MTX_SRT=no \
  -e MTX_AUTHINTERNALUSERS_0_USER=cam -e MTX_AUTHINTERNALUSERS_0_PASS="$pass" \
  "$IMAGE" >/dev/null
sleep 2
# 推流的 ffmpeg：本機有就用本機的（開發機）；沒有（例如 GCP 主機）就在攝影機容器裡跑，
# 容器內缺字型時先補 DejaVu，補不到就不疊時間戳，畫面照常。
if command -v ffmpeg >/dev/null 2>&1; then
  runner=host
  overlay=",drawtext=text='CAM%d %%{localtime}':x=20:y=20:fontsize=36:fontcolor=white:box=1:boxcolor=black@0.5"
else
  runner=container
  if docker exec "$NAME" sh -c 'apk add --no-cache font-dejavu >/dev/null 2>&1'; then
    overlay=",drawtext=fontfile=/usr/share/fonts/dejavu/DejaVuSans.ttf:text='CAM%d %%{localtime}':x=20:y=20:fontsize=36:fontcolor=white:box=1:boxcolor=black@0.5"
  else
    overlay=""
    echo "（容器內無法安裝字型，測試畫面不疊時間戳）"
  fi
fi
for i in $(seq 1 "$count"); do
  # shellcheck disable=SC2059
  vf="null$(printf "$overlay" "$i")"
  args=(-hide_banner -loglevel error -re -f lavfi -i "testsrc2=size=1280x720:rate=15"
    -f lavfi -i "sine=frequency=$((300 + i * 100))" -t "$seconds" -vf "$vf"
    -c:v libx264 -preset veryfast -tune zerolatency -g 30 -pix_fmt yuv420p -b:v 1500k -c:a aac -b:a 64k
    -f rtsp -rtsp_transport tcp)
  if [ "$runner" = host ]; then
    ffmpeg "${args[@]}" "rtsp://cam:$pass@127.0.0.1:18554/cam$i" >/dev/null 2>&1 &
  else
    docker exec -d "$NAME" ffmpeg "${args[@]}" "rtsp://cam:$pass@127.0.0.1:8554/cam$i"
  fi
done
ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || true)"
echo "已啟動 $count 路測試攝影機（$seconds 秒）：rtsp://cam:***@${ip}:18554/cam1 …"
