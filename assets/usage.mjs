import { readApiOrigin } from './api-origin.mjs';

export function recordUsage(event, ...values) {
  try {
    navigator.sendBeacon?.(new URL('/v1/event', readApiOrigin()), JSON.stringify({ event, values }));
  } catch {
    // A blocked beacon never interrupts the action.
  }
}
