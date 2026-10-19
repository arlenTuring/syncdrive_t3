import { Injectable, ServiceUnavailableException } from '@nestjs/common';

/**
 * 影像來源介面：把車載攝影機／NVR／影像平台隔離在 provider 之後。
 *
 * 目前專案沒有任何影像來源或閘道契約（2026-10-20 盤點：無 RTSP／HLS／WebRTC／NVR 設定或程式），
 * 所以只有 NotConfiguredVideoProvider：回報「尚未設定影像來源」並列出缺少的項目，不回成功的空影片。
 *
 * 接上真實來源時實作 VideoProvider：
 * - 播放位址只能由後端設定的來源解析（不接受前端傳任意 URL，避免 SSRF）。
 * - 回給瀏覽器的是短效、限定該串流的播放授權（HLS／WebRTC 閘道），不含 NVR 帳密或長效權杖。
 * - 瀏覽器不能直接播 RTSP；來源只有 RTSP 時必須經可部署的 HLS／WebRTC 媒體閘道。
 */
export type VideoSource = { id: string; vehicleCode: string | null; name: string; kind: 'live' | 'recording' };
export type VideoStream = { sourceId: string; protocol: 'hls' | 'webrtc'; url: string; expiresAt: number };
export type VideoRecording = { sourceId: string; from: number; to: number; protocol: 'hls'; url: string; expiresAt: number; mediaOffsetMs: number };

export interface VideoProvider {
  readonly configured: boolean;
  sources(): Promise<VideoSource[]>;
  stream(sourceId: string): Promise<VideoStream>;
  recordings(query: { vehicleCode: string; from: number; to: number }): Promise<VideoRecording[]>;
}

export const VIDEO_MISSING_CONTRACT = [
  '影像來源清單：每台載具（11 台）的攝影機 ID、名稱與所屬載具對照',
  '即時串流：瀏覽器可播的 HLS 或 WebRTC 閘道位址（RTSP 需先經媒體閘道轉換），及短效播放授權機制',
  '歷史片段查詢：依載具＋時間區間回傳片段與媒體時間戳（用於與軌跡對齊）',
  '品質量測來源：fps、延遲、丟幀等可取得的指標',
  '部署：閘道主機、網路連線與保存週期／容量（本系統預設不錄影）',
];

class NotConfiguredVideoProvider implements VideoProvider {
  readonly configured = false;
  async sources() {
    return [];
  }
  async stream(): Promise<VideoStream> {
    throw new ServiceUnavailableException({ status: 'NOT_CONFIGURED', message: '尚未設定影像來源' });
  }
  async recordings(): Promise<VideoRecording[]> {
    throw new ServiceUnavailableException({ status: 'NOT_CONFIGURED', message: '尚未設定影像來源' });
  }
}

@Injectable()
export class VideoService {
  // 之後依 VIDEO_PROVIDER 設定選擇實作；未設定或未知值一律視為未設定
  private readonly provider: VideoProvider = new NotConfiguredVideoProvider();

  async status() {
    return {
      configured: this.provider.configured,
      provider: process.env.VIDEO_PROVIDER?.trim() || null,
      sources: await this.provider.sources(),
      missing: this.provider.configured ? [] : VIDEO_MISSING_CONTRACT,
      recording: { enabled: false, note: '本系統預設不錄影，也不把影片存進資料庫' },
    };
  }

  stream(sourceId: string) {
    if (!/^[A-Za-z0-9._:-]{1,80}$/.test(sourceId)) throw new ServiceUnavailableException({ status: 'INVALID_SOURCE', message: '影像來源不存在' });
    return this.provider.stream(sourceId);
  }

  recordings(query: { vehicleCode: string; from: number; to: number }) {
    return this.provider.recordings(query);
  }
}
