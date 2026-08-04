import { Component, type ErrorInfo, type ReactNode } from 'react'

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
  }

  private handleRetry = () => {
    this.setState((s) => ({
      error: null,
      remountKey: s.remountKey + 1,
    }))
  }

  render() {
    const { error, remountKey } = this.state
    if (error) {
      return (
        <div className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-4 bg-[#0a0a0b] px-6 text-center">
          <div className="max-w-lg space-y-2">
            <h2 className="text-base font-semibold text-zinc-100">
              {this.props.title ?? '畫面載入失敗'}
            </h2>
            <p className="break-words font-mono text-xs text-rose-300">
              {error.message}
            </p>
            <p className="text-xs text-zinc-500">
              若剛更新過程式，請先按重試；仍失敗再硬重新整理（Cmd+Shift+R）。
            </p>
          </div>
          <button
            type="button"
            onClick={this.handleRetry}
            className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
          >
            重試
          </button>
        </div>
      )
    }

    return <div key={remountKey} className="flex h-full min-h-0 w-full flex-col">{this.props.children}</div>
  }
}
