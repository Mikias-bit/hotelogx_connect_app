// Uses the Cloud Run runtime identity; no downloaded service-account key needed.
export function createTaskDispatcher({ queue, url, audience, serviceAccountEmail, fetchImpl = fetch }) {
  let cached;
  return async hotelId => {
    if (!/^projects\/[^/]+\/locations\/[^/]+\/queues\/[^/]+$/.test(queue || '') || !url?.startsWith('https://') || !audience || !serviceAccountEmail) throw new Error('Microsoft task dispatch is not configured');
    if (!cached || cached.expires <= Date.now()) {
      const response = await fetchImpl('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
        headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(1500), redirect: 'error',
      });
      if (!response.ok) throw new Error('Runtime identity unavailable');
      const data = await response.json();
      if (!data.access_token) throw new Error('Runtime token unavailable');
      cached = { token: data.access_token, expires: Date.now() + Math.max(0, Number(data.expires_in) - 60) * 1000 };
    }
    const response = await fetchImpl(`https://cloudtasks.googleapis.com/v2/${queue}/tasks`, {
      method: 'POST', signal: AbortSignal.timeout(2000), headers: { Authorization: `Bearer ${cached.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: { dispatchDeadline: '600s', httpRequest: { url, httpMethod: 'POST', headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(JSON.stringify({ hotelId })).toString('base64'), oidcToken: { audience, serviceAccountEmail } } } }),
    });
    if (!response.ok) throw new Error('Microsoft task could not be dispatched');
  };
}
