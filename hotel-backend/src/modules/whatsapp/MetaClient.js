export const metaVersion = () => process.env.META_GRAPH_VERSION || 'v25.0';
export const validMetaId = value => typeof value === 'string' && /^\d+$/.test(value);
export const verifiedConnection = row => Boolean(row?.status === 'connected' && row.verifiedAt && row.accessToken && validMetaId(row.phoneNumberId) && validMetaId(row.wabaId) && (!row.tokenExpiresAt || row.tokenExpiresAt > new Date()));

export function createMetaClient({ fetchImpl = fetch, version = metaVersion() } = {}) {
  if (!/^v\d+\.0$/.test(version)) throw new Error('Invalid META_GRAPH_VERSION');
  return async function request(path, token, { method = 'GET', body, query = {} } = {}) {
    const url = new URL(`https://graph.facebook.com/${version}/${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    let response;
    try {
      response = await fetchImpl(url, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000), redirect: 'error' });
    } catch { throw Object.assign(new Error('Meta request did not complete; delivery may be uncertain'), { uncertain: method === 'POST' }); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
      throw Object.assign(new Error(`Meta request failed (HTTP ${response.status}, code ${data.error?.code || 'unknown'}). Check app permissions, token, and phone registration.`),
        { status: 502, metaCode: data.error?.code, uncertain: method === 'POST' && response.status >= 500 });
    }
    return data;
  };
}
