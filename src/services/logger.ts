type LogLevel = 'debug' | 'info' | 'warn' | 'error'
import { invoke } from '@tauri-apps/api/core'

const isTauriRuntime = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const write = async (text: string, level: LogLevel = 'info') => {
  if (!isTauriRuntime()) {
    return
  }

  try {
    await invoke('frontend_log', { level, message: text })
  } catch (error) {
    console.warn('Kon log niet naar backend sturen.', error)
  }
}

const stringifyError = (error: unknown): string => {
  if (!error) {
    return 'unknown error'
  }

  if (error instanceof Error) {
    const e = error as Error & {
      status?: number
      code?: string
      response?: {
        status?: number
        data?: unknown
      }
    }

    const status = e.status ?? e.response?.status
    const code = e.code
    const responseData =
      e.response?.data !== undefined ? ` response=${JSON.stringify(e.response.data)}` : ''

    return `${e.name}: ${e.message}${status !== undefined ? ` status=${status}` : ''}${code ? ` code=${code}` : ''}${responseData}${e.stack ? ` | stack: ${e.stack}` : ''}`
  }

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

const writeError = async (
  context: string,
  error: unknown,
  level: LogLevel = 'error'
) => {
  await write(`${context} | ${stringifyError(error)}`, level)
}

export const logger = {
  info: (text: string): void => {
    void write(text, 'info')
  },
  debug: (text: string): void => {
    void write(text, 'debug')
  },
  warn: (text: string): void => {
    void write(text, 'warn')
  },
  error: (context: string, error: unknown, level: LogLevel = 'error'): void => {
    void writeError(context, error, level)
  },
}
