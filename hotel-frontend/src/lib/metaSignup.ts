export function launchMetaSignup(): Promise<{ code: string; wabaId: string; phoneNumberId: string }> {
  return new Promise((resolve, reject) => {
    if (!import.meta.env.VITE_META_APP_ID || !import.meta.env.VITE_META_CONFIG_ID || !window.FB) return reject(new Error('Meta signup unavailable. Check app configuration and allow the Facebook SDK to load.'));
    let code = '', wabaId = '', phoneNumberId = '';
    let finished = false;
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', listener); };
    const fail = (message: string) => { if (finished) return; finished = true; cleanup(); reject(new Error(message)); };
    const complete = () => {
      if (finished || !code || !wabaId || !phoneNumberId) return;
      finished = true; cleanup(); resolve({ code, wabaId, phoneNumberId });
    };
    const listener = (event: MessageEvent) => {
      if (!['https://www.facebook.com', 'https://web.facebook.com'].includes(event.origin)) return;
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
        if (['CANCEL', 'ERROR'].includes(data.event)) return fail('Meta signup cancelled or failed. Please retry.');
        if (data.event !== 'FINISH') return;
        wabaId = data.data?.waba_id || ''; phoneNumberId = data.data?.phone_number_id || ''; complete();
      } catch { /* Ignore unrelated messages. */ }
    };
    const timer = window.setTimeout(() => fail('Meta signup timed out before returning the authorization code and phone identifiers.'), 300000);
    window.addEventListener('message', listener);
    try {
      window.FB.login((response: any) => {
        if (!response?.authResponse?.code) return fail('Meta authorization was not completed.');
        code = response.authResponse.code; complete();
      }, { config_id: import.meta.env.VITE_META_CONFIG_ID, response_type: 'code', override_default_response_type: true, extras: { setup: {}, sessionInfoVersion: '3' } });
    } catch { fail('Unable to open Meta signup. Allow popups and retry.'); }
  });
}
