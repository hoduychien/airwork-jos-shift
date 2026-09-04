/// <reference lib="webworker" />
import { solve } from './solver'
import type { SolverInput } from '../types'

self.onmessage = (e: MessageEvent<SolverInput>) => {
  const result = solve(e.data)
  self.postMessage(result)
}
