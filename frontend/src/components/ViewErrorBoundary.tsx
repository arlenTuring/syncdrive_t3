import { Component, type ErrorInfo, type ReactNode } from 'react'
import { isChunkLoadError, reloadForNewBuild } from '../lib/chunkReload'
import { Button } from './ui'

type Props = {
  title?: string
  children: ReactNode
}

type State = {
  error: Error | null
  remountKey: number
}

/**
 * 捕捉子樹 runtime 錯誤，避免整頁 React 根節點被清空成純黑。
 */
export class ViewErrorBoundary extends Component<Props, State> {
  state: State = { error: null, remountKey: 0 }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ViewErrorBoundary]', error, info.componentStack)
    // 程式已更新、舊分片不在了：直接重新整理載入新版
    if (isChunkLoadError(error)) reloadForNewBuild()
  }

  private handleRetry = () => {
    // 分片載入失敗重新掛載也沒用（import 結果被快取），要整頁重新整理
    if (isChunkLoadError(this.state.error)) {
      window.location.reload()
      return
    }
    this.setState((s) => ({
      error: null,
      remountKey: s.remountKey + 1,
    }))
  }

  render() {
    const { error, remountKey } = this.state
    if (error) {
      return (
        <div className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-4 bg-surface-background px-6 text-center">
          <div className="max-w-lg space-y-2">
            <h2 className="text-headline-5 text-text-primary">
              {this.props.title ?? '畫面載入失敗'}
            </h2>
            <p className="break-words font-mono text-xs text-rose-300">
              {error.message}
            </p>
            <p className="text-body-xs text-text-quaternary">
              若剛更新過程式，請先按重試；仍失敗再硬重新整理（Cmd+Shift+R）。
            </p>
          </div>
          <Button hierarchy="superior" variant="filled" onPress={this.handleRetry}>
            重試
          </Button>
        </div>
      )
    }

    return <div key={remountKey} className="flex h-full min-h-0 w-full flex-col">{this.props.children}</div>
  }
}
