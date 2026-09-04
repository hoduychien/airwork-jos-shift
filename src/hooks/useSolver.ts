import { useCallback, useEffect, useRef, useState } from 'react'
import type { SolverInput, SolverResult } from '../lib/types'

/** Chạy solver trong Web Worker để không đứng UI. */
export function useSolver() {
  const workerRef = useRef<Worker | null>(null)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    return () => workerRef.current?.terminate()
  }, [])

  const run = useCallback((input: SolverInput): Promise<SolverResult> => {
    workerRef.current?.terminate()
    const worker = new Worker(new URL('../lib/solver/worker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = worker
    setRunning(true)
    return new Promise((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<SolverResult>) => {
        setRunning(false)
        resolve(e.data)
      }
      worker.onerror = (err) => {
        setRunning(false)
        reject(err)
      }
      worker.postMessage(input)
    })
  }, [])

  return { run, running }
}
