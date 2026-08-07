/**
 * 瀏覽器端 API 基底 URL。
 * 開發模式走 Vite `/syncdrive-api` 代理，避免 localhost / 127.0.0.1 交叉造成 Failed to fetch。
 */
export function resolveBrowserApiBaseUrl(configured?: string | null): string {
  if (import.meta.env.DEV) {
    return '';
  }
  const raw = (configured?.trim() || 'http://127.0.0.1:3000').replace(/\/$/, '');
  return raw.replace('//localhost:', '//127.0.0.1:');
}
