/// <reference types="vite/client" />
import type { OraApi } from '@shared/api'

declare global {
  interface Window {
    ora: OraApi
  }
}

declare module '*?worker' {
  const WorkerConstructor: new () => Worker
  export default WorkerConstructor
}
