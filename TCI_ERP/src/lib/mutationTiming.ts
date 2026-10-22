/** Dev-only mutation timing log. main.tsx imports this module ONLY behind
 * `import.meta.env.DEV`, so a production build carries none of it.
 *
 * One console line per mutation, when it settles:
 *
 *   [mutation] agenda.complete 412ms · paint 9ms
 *
 * - the total is start → settle (the round trip the person waits for);
 * - paint is click → the first animation frame after the mutation's own
 *   change reached the cache: the optimistic patch when there is one, the
 *   pending state (the in-place spinner) otherwise. That is the figure the
 *   100 ms budget is about.
 *
 * "Click" is the triggering DOM event's timestamp when the mutation was
 * started inside an event handler, else the moment it was started. */

import type { Mutation, MutationCache } from '@tanstack/react-query'

interface Timing {
  label: string
  start: number
  paint: number | null
}

/** The pure part: what one line says. */
export function timingLine(label: string, totalMs: number, paintMs: number | null, failed: boolean): string {
  const paint = paintMs === null ? '' : ` · paint ${Math.round(paintMs)}ms`
  return `[mutation] ${label} ${Math.round(totalMs)}ms${paint}${failed ? ' · refused' : ''}`
}

export function mutationLabel(mutation: Pick<Mutation, 'options' | 'mutationId'>): string {
  const key = mutation.options.mutationKey
  return key && key.length > 0 ? key.map(String).join('.') : `mutation#${mutation.mutationId}`
}

/** After React has had the change (the query notifications are flushed on a
 * zero timeout), the next frame is the one that paints it. */
function afterPaint(callback: (at: number) => void) {
  setTimeout(() => requestAnimationFrame((at) => callback(at)), 0)
}

export function attachMutationTiming(cache: MutationCache): () => void {
  const timings = new WeakMap<object, Timing>()
  return cache.subscribe((event) => {
    const mutation = event.mutation
    if (!mutation) return
    if (event.type === 'added') {
      const trigger = typeof window !== 'undefined' ? window.event : undefined
      const timing: Timing = { label: mutationLabel(mutation), start: trigger?.timeStamp ?? performance.now(), paint: null }
      timings.set(mutation, timing)
      // Without a patch, the pending state is the feedback.
      afterPaint((at) => {
        if (timing.paint === null && mutation.state.context === undefined) timing.paint = at - timing.start
      })
      return
    }
    if (event.type !== 'updated') return
    const timing = timings.get(mutation)
    if (!timing) return
    const action = event.action
    if (action.type === 'pending' && action.context !== undefined) {
      afterPaint((at) => {
        timing.paint = at - timing.start
      })
    } else if (action.type === 'success' || action.type === 'error') {
      console.info(timingLine(timing.label, performance.now() - timing.start, timing.paint, action.type === 'error'))
      timings.delete(mutation)
    }
  })
}
