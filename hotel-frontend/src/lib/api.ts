const isLocalBrowser = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
export const API_BASE_URL = isLocalBrowser
  ? (import.meta.env.VITE_API_LOCAL_URL || 'http://localhost:5000/api')
  : (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api');

async function getOrRefreshToken(): Promise<string | null> {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem('token');
}

function expireSession() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('token');
  localStorage.removeItem('hotelogx.session.v1');
  localStorage.removeItem('hotelogx.user.v1');
  window.dispatchEvent(new Event('hotelogx:session-expired'));
}

async function request<T>(endpoint: string, options: RequestInit = {}, isRetry = false): Promise<T | null> {
  const strict = endpoint.startsWith('/whatsapp/') || endpoint === '/email/test-connection' || endpoint === '/email/disconnect' || endpoint === '/auth/login' || endpoint === '/auth/register' ||
    endpoint.startsWith('/email/oauth/google?') || endpoint.startsWith('/email/oauth/microsoft?') || (endpoint === '/onboarding/profile' && options.method === 'POST');
  const publicAuth = endpoint === '/auth/login' || endpoint === '/auth/register';
  try {
    const url = `${API_BASE_URL}${endpoint}`;
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const headers: Record<string, string> = {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...((options.headers as Record<string, string>) || {}),
    };

    if (typeof localStorage !== 'undefined' && !headers['Authorization'] && !endpoint.startsWith('/auth/login') && !endpoint.startsWith('/auth/refresh')) {
      const token = await getOrRefreshToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    if (strict && !publicAuth && !headers['Authorization']) {
      expireSession();
      throw new Error('Please sign in to your hotel manager account before saving or connecting email.');
    }
    const res = await fetch(url, {
      ...options,
      headers,
    });

    if (res.status === 401 && !isRetry && !endpoint.startsWith('/auth/login') && !endpoint.startsWith('/auth/refresh')) {
      const currentToken = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
      const sentToken = headers['Authorization']?.replace(/^Bearer /, '') || null;
      if (currentToken && currentToken === sentToken) {
        try {
          const refreshRes = await fetch(`${API_BASE_URL}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentToken}` },
            body: JSON.stringify({ token: currentToken }),
          });
          if (refreshRes.ok) {
            const json = await refreshRes.json();
            const freshToken = json?.data?.token || json?.token;
            if (freshToken && localStorage.getItem('token') === currentToken) {
              localStorage.setItem('token', freshToken);
              return request<T>(
                endpoint,
                {
                  ...options,
                  headers: {
                    ...headers,
                    Authorization: `Bearer ${freshToken}`,
                  },
                },
                true,
              );
            }
          }
        } catch { }
      }
      if (typeof localStorage !== 'undefined') {
        if (currentToken === sentToken && localStorage.getItem('token') === currentToken) expireSession();
      }
    }

    if (!res.ok) {
      if (res.status === 401) {
        if (typeof localStorage !== 'undefined') {
          if (!publicAuth && headers['Authorization'] === `Bearer ${localStorage.getItem('token')}`) expireSession();
        }
      } else {
        console.warn(`API request to ${endpoint} returned status ${res.status}`);
      }
      if (strict) {
        const failure = await res.json().catch(() => null);
        throw new Error(res.status === 401 && !publicAuth
          ? 'Your session has expired. Please sign in again.'
          : failure?.message || `Request failed (${res.status}). Please try again.`);
      }
      return null;
    }

    const json = await res.json();
    return json.data !== undefined ? json.data : json;
  } catch (err) {
    if (strict) throw err;
    console.warn(`API request to ${endpoint} failed (backend might be offline, using local store):`, err);
    return null;
  }
}

async function invitationRequest<T>(path: string, body: unknown): Promise<T> {
  const token = await getOrRefreshToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success) throw new Error(result?.message || 'Invitation failed. Please sign in again or check the hotel mailbox.');
  return result.data;
}

export const api = {
  // Rooms
  getRooms: () => request<any[]>('/rooms'),
  updateRoomStatus: (number: string, status: string, cleaner?: string, note?: string) =>
    request(`/rooms/${number}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, cleaner, note }),
    }),

  // Tasks
  getTasks: () => request<any[]>('/tasks'),
  createTask: (data: any) =>
    request('/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateTaskStatus: (id: string, status: string, note?: string, via?: string, assignee?: string) =>
    request(`/tasks/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, note, via, ...(assignee !== undefined ? { assignee } : {}) }),
    }),

  // Issues / Maintenance
  getIssues: () => request<any[]>('/issues'),
  createIssue: (data: any) =>
    request('/issues', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateIssueStatus: (id: string, status: string, note?: string, via?: string) =>
    request(`/issues/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, note, via }),
    }),
  assignIssue: (id: string, assignee: string) =>
    request(`/issues/${id}/assign`, {
      method: 'PATCH',
      body: JSON.stringify({ assignee }),
    }),

  // Auth
  login: (credentials: { email?: string; password?: string; userId?: string }) =>
    request<{ token: string; user: any }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    }),
  registerHotel: (data: { hotelName: string; managerName: string; email: string; password?: string; phone?: string }) =>
    request<{ token: string; user: any; hotel: any }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getMe: () => request<any>('/auth/me'),

  connectPms: (provider: string, propertyId: string, clientToken?: string) =>
    request<any>('/pms/connect', {
      method: 'POST',
      body: JSON.stringify({ provider, propertyId, clientToken }),
    }),
  disconnectPms: () =>
    request<any>('/pms/disconnect', {
      method: 'POST',
    }),
  getPmsStatus: () => request<any>('/pms/status'),
  syncPms: () =>
    request<any>('/pms/sync', {
      method: 'POST',
    }),
  getPmsRooms: () => request<any[]>('/pms/rooms'),
  getPmsReservations: () => request<any[]>('/pms/reservations'),
  checkAvailability: (params?: { checkIn?: string; checkOut?: string }) =>
    request<any>(`/pms/availability${params ? `?${new URLSearchParams(params as any).toString()}` : ''}`),


  // Conversations / Chat
  getConversations: () => request<any[]>('/conversations'),
  getConversationById: (id: string) => request<any>(`/conversations/${id}`),
  sendReply: (id: string, body: string, staffName?: string, channel?: string, toEmail?: string) =>
    request(`/conversations/${id}/reply`, {
      method: 'POST',
      body: JSON.stringify({ body, staffName, channel, toEmail }),
    }),
  toggleTakeover: (id: string, aiStatus?: string) =>
    request(`/conversations/${id}/takeover`, {
      method: 'POST',
      body: JSON.stringify({ aiStatus }),
    }),
  escalateConversation: (id: string, reason?: string, urgency?: string, suggested?: string) =>
    request(`/conversations/${id}/escalate`, {
      method: 'POST',
      body: JSON.stringify({ reason, urgency, suggested }),
    }),
  resolveConversation: (id: string) =>
    request(`/conversations/${id}/resolve`, {
      method: 'POST',
    }),

  // Upsells
  getUpsells: () => request<any[]>('/upsells'),
  updateUpsellStatus: (id: string, status: string) =>
    request(`/upsells/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  // WhatsApp Simulator
  getWaThreads: () => request<any[]>('/whatsapp/threads'),
  replyToWhatsAppThread: (id: string, message: string) => request<any>(`/whatsapp/threads/${encodeURIComponent(id)}/reply`, { method: 'POST', body: JSON.stringify({ message }) }),
  sendWaAction: (data: any) =>
    request('/whatsapp/action', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Manager & Health
  getBriefing: () => request<any>('/manager/briefing'),
  getActivity: () => request<any[]>('/manager/activity'),
  getAiRules: () => request<any>('/manager/rules'),
  saveAiRules: (data: { aiMode?: string; rules?: Array<{ topic: string; mode: string; note?: string }> }) =>
    request<any>('/manager/rules', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  getKnowledge: () => request<any[]>('/knowledge'),
  getKnowledgeDocs: () => request<any[]>('/knowledge'),
  uploadKnowledgeDoc: (file: File, category?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    if (category) {
      formData.append('category', category);
    }
    return request<any>('/knowledge', {
      method: 'POST',
      body: formData,
    });
  },
  deleteKnowledgeDoc: (id: string) =>
    request<any>(`/knowledge/${id}`, {
      method: 'DELETE',
    }),
  getHealth: () => request<any>('/health'),

  // Onboarding & Setup
  getOnboarding: () => request<any>('/onboarding/status'),
  getHotelProfile: () => request<any>('/onboarding/profile'),
  saveHotelProfile: (profileData: any) =>
    request('/onboarding/profile', {
      method: 'POST',
      body: JSON.stringify(profileData),
    }),
  saveTopology: (topology: string) =>
    request('/onboarding/topology', {
      method: 'POST',
      body: JSON.stringify({ topology }),
    }),
  saveOnboardingStep: (stepKey: string, data?: any) =>
    (stepKey === 'users' && data?.email ? invitationRequest('/onboarding/step', { stepKey, data }) : request('/onboarding/step', {
      method: 'POST',
      body: JSON.stringify({ stepKey, data }),
    })),
  completeOnboarding: () =>
    request('/onboarding/complete', {
      method: 'POST',
    }),
  // Users & Staff
  getUsers: () => request<any[]>('/users'),
  inviteUser: (data: { email: string; role: string; name?: string; title?: string; phone?: string; whatsapp?: boolean }) =>
    invitationRequest<any>('/users/invite', data),
  updateUserRole: (id: string, role: string) =>
    request<any>(`/users/${id}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    }),
  deleteUser: (id: string) =>
    request<any>(`/users/${id}`, {
      method: 'DELETE',
    }),

  // Billing & Subscriptions
  getSubscription: () => request<any>('/billing/subscription'),
  getInvoices: () => request<any[]>('/billing/invoices'),
  updateSubscription: (data: { plan?: string; billingCycle?: string; rooms?: number }) =>
    request<any>('/billing/subscription', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  // Email Integration
  getEmailStatus: () =>
    request<{ connected: boolean; provider: string | null; email: string | null; lastSyncAt?: string | null }>('/email/status'),
  disconnectEmail: () =>
    request<{ disconnected: boolean }>('/email/disconnect', { method: 'POST' }),
  getGoogleOAuthUrl: (redirectBack: string = '/onboarding', hotelId?: string) =>
    request<{ url: string; hotelId: string }>(
      `/email/oauth/google?redirectBack=${encodeURIComponent(redirectBack)}${hotelId ? `&hotelId=${encodeURIComponent(hotelId)}` : ''}`
    ),
  getMicrosoftOAuthUrl: (redirectBack: string = '/onboarding') =>
    request<{ url: string; hotelId: string }>(`/email/oauth/microsoft?redirectBack=${encodeURIComponent(redirectBack)}`),
  syncGmail: () =>
    request<any>('/email/sync', { method: 'POST' }),
  getOnboardingStatus: () =>
    request<any>('/onboarding/status'),
  testEmailConnection: (data: { email: string; password?: string; host?: string; port?: number; method?: string; settings?: import('./types').EmailServerSettings | null; smtpPassword?: string }) =>

    request<any>('/email/test-connection', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  sendGuestEmail: (data: { conversationId?: string; toEmail: string; subject?: string; text: string; author?: string; threadId?: string }) =>
    request<any>('/email/send', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getDashboardTrends: () =>
    request<{
      weekdays: string[];
      conversationTrend: number[];
      aiTrend: number[];
      upsellTrend: number[];
      hasData: boolean;
    }>('/manager/trends'),
  // WhatsApp Embedded Signup
  exchangeMetaEmbeddedSignup: (data: {
    code?: string;
    wabaId?: string;
    phoneNumberId?: string;
    displayPhoneNumber?: string;
    targetType?: string;
    pin?: string;
    hotelId?: string;
  }) =>
    request<any>('/whatsapp/embedded-signup', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  // WhatsApp Direct API Credentials Connection
  connectManualWhatsApp: (data: {
    phoneNumberId: string;
    accessToken: string;
    displayPhoneNumber?: string;
    wabaId?: string;
    targetType?: string;
    pin?: string;
    hotelId?: string;
  }) =>
    request<any>('/whatsapp/connect-manual', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getWhatsAppStatus: () => request<any>('/whatsapp/status'),
  disconnectWhatsApp: () =>
    request<any>('/whatsapp/disconnect', {
      method: 'POST',
    }),
  sendWhatsAppTestMessage: (to: string, message?: string, targetType = 'guest') =>
    request<any>('/whatsapp/send', {
      method: 'POST',
      body: JSON.stringify({ to, targetType, message: message || 'Hello! This is a test message from Hotelogx Connect.' }),
    }),
};



