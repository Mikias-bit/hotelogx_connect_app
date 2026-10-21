import { MicrosoftGraphEmailAdapter } from './microsoft/MicrosoftGraphEmailAdapter.js';
import { config } from '../../config/env.js';
import { prisma } from '../../config/database.js';
import { encryptToken, decryptToken, generateOAuthState, verifyOAuthState } from '../../utils/tokenCrypto.js';

export const MICROSOFT_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'User.Read',
  'Mail.Read',
  'Mail.Send',
];

function getTenantAuthority(tenantId) {
  const tenant = tenantId || (process.env.MICROSOFT_OAUTH_TENANT_ID || process.env.MICROSOFT_TENANT_ID) || 'common';
  return `https://login.microsoftonline.com/${tenant.trim()}/oauth2/v2.0`;
}

function getGraphBaseUrl() {
  return (process.env.MICROSOFT_GRAPH_BASE_URL || 'https://graph.microsoft.com/v1.0').replace(/\/+$/, '');
}

/**
 * Production-ready Microsoft Graph & Identity API Client
 */
export const microsoftClient = {
  /**
   * Generates Microsoft OAuth 2.0 authorization URL with cryptographically signed state
   */
  getMicrosoftOAuthUrl(hotelId, redirectBack = '/onboarding', frontendOrigin = null) {
    const clientId = (process.env.MICROSOFT_OAUTH_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID) || (process.env.NODE_ENV === 'test' ? 'test-ms-client-id' : null);
    const redirectUri = process.env.MICROSOFT_OAUTH_REDIRECT_URI || process.env.MICROSOFT_REDIRECT_URI || `${config.backendBaseUrl}/api/email-integrations/microsoft/callback`;

    if (!clientId) {
      throw new Error('MICROSOFT_CLIENT_ID is not configured in environment variables');
    }

    const state = generateOAuthState(hotelId, redirectBack, frontendOrigin, 'microsoft_oauth');
    const authority = getTenantAuthority();

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      response_mode: 'query',
      scope: MICROSOFT_SCOPES.join(' '),
      state,
      prompt: 'select_account',
    });

    return `${authority}/authorize?${params.toString()}`;
  },

  /**
   * Exchanges temporary authorization code for Microsoft access and refresh tokens
   */
  async exchangeCodeForTokens(code) {
    const clientId = (process.env.MICROSOFT_OAUTH_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID) || (process.env.NODE_ENV === 'test' ? 'test-ms-client-id' : null);
    const clientSecret = (process.env.MICROSOFT_OAUTH_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET) || (process.env.NODE_ENV === 'test' ? 'test-ms-client-secret' : null);
    const redirectUri = process.env.MICROSOFT_OAUTH_REDIRECT_URI || process.env.MICROSOFT_REDIRECT_URI || `${config.backendBaseUrl}/api/email-integrations/microsoft/callback`;

    if (!clientId || !clientSecret) {
      throw new Error('MICROSOFT_CLIENT_ID or MICROSOFT_CLIENT_SECRET missing in backend configuration');
    }

    const authority = getTenantAuthority();
    const tokenEndpoint = `${authority}/token`;

    const res = await fetch(tokenEndpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        scope: MICROSOFT_SCOPES.join(' '),
      }).toString(),
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      const errMsg = data.error_description || data.error || 'Failed to exchange authorization code with Microsoft';
      throw new Error(`Microsoft OAuth Exchange Error: ${errMsg}`);
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      expiresIn: Number(data.expires_in) || 3600,
      scope: data.scope,
      tokenType: data.token_type,
    };
  },

  /**
   * Refreshes an expired Microsoft access token using the stored refresh token
   */
  /**
   * Refreshes expired Microsoft access token using stored refresh token.
   * If hotelId is provided, automatically encrypts and persists the rotated tokens to MySQL.
   */
  async refreshAccessToken(arg1, arg2) {
    const hotelId = arg2 ? arg1 : null;
    const refreshToken = arg2 || arg1;

    const clientId = process.env.MICROSOFT_OAUTH_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_OAUTH_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('Microsoft OAuth credentials missing');

    const authority = getTenantAuthority();
    const tokenEndpoint = `${authority}/token`;

    const res = await fetch(tokenEndpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: MICROSOFT_SCOPES.join(' '),
      }).toString(),
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      const errMsg = data.error_description || data.error || 'Token refresh failed';
      throw new Error(`Microsoft Token Refresh Error: ${errMsg}`);
    }

    const result = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken, // Microsoft may rotate refresh tokens
      expiresIn: Number(data.expires_in) || 3600,
      scope: data.scope,
    };

    if (hotelId) {
      const encryptedAccess = encryptToken(result.accessToken);
      const encryptedRefresh = result.refreshToken ? encryptToken(result.refreshToken) : null;
      const newExpiry = new Date(Date.now() + result.expiresIn * 1000);

      await prisma.emailIntegration.update({
        where: { hotelId },
        data: {
          accessToken: encryptedAccess,
          ...(encryptedRefresh ? { refreshToken: encryptedRefresh } : {}),
          tokenExpiry: newExpiry,
          status: 'connected',
          lastError: null,
        },
      });
    }

    return result;
  },

  /**
   * Retrieves verified Microsoft 365 profile from Microsoft Graph /v1.0/me
   */
  async getAuthenticatedMicrosoftUser(accessToken) {
    const graphBase = getGraphBaseUrl();
    const res = await fetch(`${graphBase}/me`, {
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Failed to retrieve Microsoft profile: ${errText || res.statusText}`);
    }

    const profile = await res.json();
    const email = profile.mail || profile.userPrincipalName || '';

    if (!email) {
      throw new Error('Microsoft account does not have an active mailbox address');
    }

    return {
      id: profile.id,
      email,
      mail: profile.mail || email,
      displayName: profile.displayName || email.split('@')[0],
      userPrincipalName: profile.userPrincipalName,
    };
  },

  async getAuthenticatedMicrosoftProfile(accessToken) {
    return await this.getAuthenticatedMicrosoftUser(accessToken);
  },

  /**
   * Returns a valid decrypted access token string for hotel tenant
   */
  async getValidAccessToken(hotelId) {
    const { accessToken } = await this.getValidAccessTokenForHotel(hotelId);
    return accessToken;
  },

  /**
   * Resolves valid, unexpired access token for hotel tenant; auto-refreshes if needed
   */
  async getValidAccessTokenForHotel(hotelId) {
    if (!hotelId) {
      throw new Error('hotelId is required to resolve Microsoft token');
    }

    const integration = await prisma.emailIntegration.findUnique({
      where: { hotelId },
    });

    if (!integration || integration.provider !== 'microsoft' || !integration.accessToken) {
      throw new Error(`Hotel '${hotelId}' does not have an active Microsoft 365 integration`);
    }

    let rawAccessToken = decryptToken(integration.accessToken);
    const rawRefreshToken = integration.refreshToken ? decryptToken(integration.refreshToken) : null;

    // Check expiration with a 60-second buffer
    const isExpired = integration.tokenExpiry
      ? Date.now() >= new Date(integration.tokenExpiry).getTime() - 60000
      : false;

    if (isExpired && !rawRefreshToken) throw new Error('Microsoft offline access missing; reconnect mailbox');
    if (isExpired && rawRefreshToken) {
      try {
        const refreshed = await this.refreshAccessToken(hotelId, rawRefreshToken);
        rawAccessToken = refreshed.accessToken;
      } catch (refreshErr) {
        await prisma.emailIntegration.update({
          where: { hotelId },
          data: {
            lastError: 'Microsoft token refresh failed; retry or reconnect the mailbox',
          },
        }).catch(() => {});
        throw new Error(`Microsoft access expired and could not be refreshed. (${refreshErr.message})`);
      }
    }

    return {
      accessToken: rawAccessToken,
      email: integration.email,
      integration,
    };
  },

  /**
   * Fetches recent messages from Microsoft 365 Inbox with resilience, retry, and pagination
   */
  async fetchRecentMicrosoftMessages(hotelId, maxResults = 10) {
    let { accessToken, integration } = await this.getValidAccessTokenForHotel(hotelId);
    const graphBase = getGraphBaseUrl();
    const endpoint = `${graphBase}/me/mailFolders/inbox/messages?$top=${maxResults}&$select=id,internetMessageId,conversationId,subject,receivedDateTime,from,sender,toRecipients,body,bodyPreview,isRead&$orderby=receivedDateTime desc`;

    let response = null;
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        response = await fetch(endpoint, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(10000),
        });

        // 401 Unauthorized: token may have been revoked or invalidated; attempt 1 refresh and retry
        if (response.status === 401 && attempts === 1) {
          const rawRefreshToken = integration.refreshToken ? decryptToken(integration.refreshToken) : null;
          if (rawRefreshToken) {
            const refreshed = await this.refreshAccessToken(rawRefreshToken);
            accessToken = refreshed.accessToken;
            await prisma.emailIntegration.update({
              where: { hotelId },
              data: {
                accessToken: encryptToken(refreshed.accessToken),
                refreshToken: refreshed.refreshToken ? encryptToken(refreshed.refreshToken) : integration.refreshToken,
                tokenExpiry: new Date(Date.now() + refreshed.expiresIn * 1000),
              },
            }).catch(() => {});
            continue;
          }
        }

        // 429 Rate Limiting: check Retry-After
        if (response.status === 429) {
          const retryAfter = typeof response.headers?.get === 'function' ? response.headers.get('Retry-After') : null;
          const delayMs = process.env.NODE_ENV === 'test'
            ? 30
            : (retryAfter ? Math.max(parseInt(retryAfter, 10) * 1000, 1000) : 2000);
          if (attempts < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            continue;
          }
        }

        // 5xx Server Error: retry with exponential backoff
        if (response.status >= 500 && attempts < maxAttempts) {
          const delayMs = process.env.NODE_ENV === 'test' ? 30 : (attempts * 1500);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        break;
      } catch (netErr) {
        if (attempts < maxAttempts) {
          const delayMs = process.env.NODE_ENV === 'test' ? 30 : (attempts * 1500);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        throw new Error(`Microsoft Graph network failure: ${netErr.message}`);
      }
    }

    if (!response || !response.ok) {
      const errText = await response?.text().catch(() => '');
      throw new Error(`Microsoft Graph returned HTTP ${response?.status || 'ERR'}: ${errText || 'Inbox query failed'}`);
    }

    const data = await response.json();
    const rawMessages = data.value || [];

    const mapped = rawMessages.map((msg) => {
      const fromEmail = msg.from?.emailAddress?.address || msg.sender?.emailAddress?.address || '';
      const fromName = msg.from?.emailAddress?.name || msg.sender?.emailAddress?.name || fromEmail.split('@')[0] || 'Guest';
      const toRecipients = (msg.toRecipients || []).map((r) => r.emailAddress?.address).filter(Boolean);

      let textContent = '';
      if (msg.body?.contentType?.toLowerCase() === 'html' && msg.body.content) {
        // Strip HTML tags for clean body text while preserving text content
        textContent = msg.body.content
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<br\s*[\/]?>/gi, '\n')
          .replace(/<\/p>/gi, '\n\n')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/\n\s*\n+/g, '\n\n')
          .trim();
      }

      if (!textContent) {
        textContent = msg.bodyPreview || msg.body?.content || 'No message content';
      }

      return {
        id: msg.id,
        internetMessageId: msg.internetMessageId || null,
        conversationId: msg.conversationId || null,
        from: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
        fromEmail,
        fromName,
        to: toRecipients.join(', '),
        subject: msg.subject || 'Guest Inquiry',
        bodyText: textContent,
        bodyHtml: msg.body?.contentType?.toLowerCase() === 'html' ? msg.body.content : null,
        date: msg.receivedDateTime,
        isRead: Boolean(msg.isRead),
      };
    });

    mapped.messages = mapped;
    mapped.nextLink = data['@odata.nextLink'] || null;
    return mapped;
  },

  /**
   * Outbound email dispatch via Microsoft Graph API (/v1.0/me/sendMail or /v1.0/me/messages/{id}/reply)
   */
  async sendGuestMicrosoftMail({ hotelId, to, toEmail, subject, text, bodyText, bodyHtml, targetMessageId, messageId }) {
    const recipient = to || toEmail;
    const content = bodyText || text;
    if (!hotelId || !recipient || (!content && !bodyHtml)) throw new Error('Hotel, recipient and message content required');
    const { integration } = await this.getValidAccessTokenForHotel(hotelId);
    const adapter = new MicrosoftGraphEmailAdapter(integration, { getToken: id => this.getValidAccessTokenForHotel(id) });
    // Graph conversationId is NOT a message ID. Use the persisted inbound message ID.
    const target = targetMessageId || messageId;
    if (target) return adapter.reply({ targetMessageId: target, bodyText: content || bodyHtml });
    const recipients = recipient.split(',').map(value => ({ emailAddress: { address: value.replace(/.*<(.+?)>.*/, '$1').trim() } }));
    if (recipients.some(r => !r.emailAddress.address.includes('@'))) throw new Error('Invalid recipient');
    await adapter.request('/me/sendMail', { method: 'POST', body: { message: { subject: subject || 'Message from Hotel Reception',
      body: { contentType: bodyHtml ? 'HTML' : 'Text', content: bodyHtml || content }, toRecipients: recipients }, saveToSentItems: true } });
    return { success: true, provider: 'microsoft', messageId: null };
  },

  /**
   * Safe test connection method for Microsoft Graph
   */
  async testConnection(hotelId) {
    const { accessToken, email } = await this.getValidAccessTokenForHotel(hotelId);
    const profile = await this.getAuthenticatedMicrosoftUser(accessToken);

    return {
      success: true,
      verified: true,
      provider: 'microsoft',
      email: profile.email || email,
      displayName: profile.displayName,
      status: 'connected',
    };
  },
};
