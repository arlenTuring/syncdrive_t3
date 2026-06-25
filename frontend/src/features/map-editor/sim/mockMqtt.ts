/**
 * 開發／示範用：記憶體內 MQTT 行為模擬（無網路、無 broker）。
 * 之後可抽成介面 IMqttClient，實作改接 mqtt.js + WebSocket 即可。
 */

export type MockMqttMessage = {
  topic: string
  /** 已解好的 UTF-8 字串（通常為 JSON） */
  payload: string
}

type Listener = (msg: MockMqttMessage) => void

/** 簡易萬用字：# 全收、精確、單層 +、結尾 #（多層下層） */
function topicMatches(pattern: string, topic: string): boolean {
  if (pattern === '#' || pattern === '') return true
  if (pattern === topic) return true
  if (pattern.endsWith('/#')) {
    const p = pattern.slice(0, -2)
    return topic === p || topic.startsWith(`${p}/`)
  }
  const pParts = pattern.split('/')
  const tParts = topic.split('/')
  if (pParts.length !== tParts.length) return false
  for (let i = 0; i < pParts.length; i++) {
    if (pParts[i] === '+') continue
    if (pParts[i] !== tParts[i]) return false
  }
  return true
}

export function createMockMqttClient() {
  const listeners = new Set<Listener>()

  return {
    /** 訂閱；pattern 可為精確 topic 或含 + /# */
    subscribe(pattern: string, fn: Listener): () => void {
      const wrapped: Listener = (msg) => {
        if (topicMatches(pattern, msg.topic)) fn(msg)
      }
      listeners.add(wrapped)
      return () => listeners.delete(wrapped)
    },

    /** 模擬 broker 轉發一則訊息給所有訂閱者 */
    publish(topic: string, payload: string | object): void {
      const payloadStr =
        typeof payload === 'string' ? payload : JSON.stringify(payload)
      const msg: MockMqttMessage = { topic, payload: payloadStr }
      for (const fn of listeners) {
        fn(msg)
      }
    },
  }
}

/** 單例，方便在 React 外或 devtools 呼叫：`import { mockMqttSingleton } from '...'` */
export const mockMqttSingleton = createMockMqttClient()
