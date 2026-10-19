#!/usr/bin/env bash
# 本機影像管線測試用的「合成攝影機」：一個獨立的 MediaMTX 容器（模擬區網攝影機，RTSP 18554），
# 由 ffmpeg 推送 N 路測試畫面（含時間戳），每路有時間上限，跑完自動停止。只供開發／整合測試。
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
for i in $(seq 1 "$count"); do
  ffmpeg -hide_banner -loglevel error -re -f lavfi -i "testsrc2=size=1280x720:rate=15" \
    -f lavfi -i "sine=frequency=$((300 + i * 100))" -t "$seconds" \
    -vf "drawtext=text='CAM$i %{localtime}':x=20:y=20:fontsize=36:fontcolor=white:box=1:boxcolor=black@0.5" \
    -c:v libx264 -preset veryfast -tune zerolatency -g 30 -pix_fmt yuv420p -b:v 1500k -c:a aac -b:a 64k \
    -f rtsp -rtsp_transport tcp "rtsp://cam:$pass@127.0.0.1:18554/cam$i" >/dev/null 2>&1 &
done
ip="$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')"
echo "已啟動 $count 路測試攝影機（$seconds 秒）：rtsp://cam:***@${ip}:18554/cam1 …"
