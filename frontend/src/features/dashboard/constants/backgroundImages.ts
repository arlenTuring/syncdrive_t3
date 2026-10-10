/**
 * 內建背景圖清單（frontend/public/dashboard-icons/background）。只做小型清單選擇，
 * 不做上傳、媒體庫、裁切或任意 URL；要加新背景就把檔案放進資料夾、在這裡登記。
 */
export type BuiltinBackgroundImage = {
  id: string;
  label: string;
  url: string;
  /** 原始比例（設計稿尺寸），屬性面板預覽用 */
  width: number;
  height: number;
};

export const BUILTIN_BACKGROUND_IMAGES: BuiltinBackgroundImage[] = [
  { id: 'bg1', label: '車輛資訊卡（底部凹槽）', url: '/dashboard-icons/background/bg1.svg', width: 339, height: 191 },
];

/**
 * 背景的 CSS：圖片疊在背景顏色上、不重複；預設等比完整呈現（contain），不用 cover 裁掉造型。
 * 沒有圖片時只有顏色。
 */
export function canvasBackgroundCss(
  backgroundColor: string | undefined,
  backgroundImage: string | undefined,
  fit: 'contain' | 'cover' = 'contain',
): string {
  const color = backgroundColor || 'transparent';
  if (!backgroundImage) return color;
  return `url("${backgroundImage}") center / ${fit} no-repeat, ${color}`;
}
