import { readApiOrigin } from './api-origin.mjs';

const storageKey = 'domain-hound-internal';
const flag = new URLSearchParams(location.search).get('internal');
let storageAvailable = true;
try {
  if (flag === '1') localStorage.setItem(storageKey, '1');
  if (flag === '0') localStorage.removeItem(storageKey);
} catch {
  // Storage can be blocked. The explicit flag still works for this page.
  storageAvailable = false;
}

export function isInternalTraffic() {
  try {
    if (!storageAvailable) return flag === '1';
    return localStorage.getItem(storageKey) === '1';
  } catch {
    return flag === '1';
  }
}

export function recordUsage(event, ...values) {
  try {
    const data = { event, values, ...(isInternalTraffic() && { internal: 1 }) };
    navigator.sendBeacon?.(new URL('/v1/event', readApiOrigin()), JSON.stringify(data));
  } catch {
    // A blocked beacon never interrupts the action.
  }
}
