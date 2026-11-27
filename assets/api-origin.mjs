const hosted = 'https://domainhound-mcp.domainhound.workers.dev';

export function readApiOrigin() {
  const configured = document.querySelector('meta[name="domain-hound-api"]')?.content.trim();
  const apiBase = new URL(configured || hosted);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(apiBase.hostname);
  if (apiBase.username || apiBase.password || (apiBase.protocol !== 'https:' && !(loopback && apiBase.protocol === 'http:'))) {
    throw new Error('Invalid search API origin');
  }
  return apiBase.origin;
}
