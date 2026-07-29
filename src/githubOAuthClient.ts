const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';
const GITHUB_OAUTH_SCOPE = 'read:user,repo';

export type GithubOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type GithubTokenExchangeResult = {
  access_token: string;
  scope?: string;
  token_type?: string;
};

export type GithubAuthenticatedUser = {
  login: string;
  id: number;
  avatar_url?: string;
};

export function getGithubOAuthConfig(): GithubOAuthConfig | null {
  const clientId = process.env.GITHUB_CLIENT_ID || '';
  const clientSecret = process.env.GITHUB_CLIENT_SECRET || '';
  const redirectUri = process.env.GITHUB_OAUTH_REDIRECT_URI || '';
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function isGithubOAuthConfigured(): boolean {
  return getGithubOAuthConfig() !== null;
}

export function buildGithubAuthorizeUrl(state: string): string {
  const config = getGithubOAuthConfig();
  if (!config) throw new Error('github_oauth_not_configured');
  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', GITHUB_OAUTH_SCOPE);
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeGithubOAuthCode(code: string): Promise<GithubTokenExchangeResult> {
  const config = getGithubOAuthConfig();
  if (!config) throw new Error('github_oauth_not_configured');

  const response = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code
    })
  });

  const body = (await response.json()) as { access_token?: string; scope?: string; token_type?: string; error?: string; error_description?: string };
  if (!response.ok || !body.access_token) {
    throw new Error(body.error_description || body.error || 'github_token_exchange_failed');
  }
  return { access_token: body.access_token, scope: body.scope, token_type: body.token_type };
}

export async function fetchGithubAuthenticatedUser(accessToken: string): Promise<GithubAuthenticatedUser> {
  const response = await fetch(GITHUB_USER_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'merlin-os-action-layer'
    }
  });
  const body = (await response.json()) as { login?: string; id?: number; avatar_url?: string; message?: string };
  if (!response.ok || !body.login || typeof body.id !== 'number') {
    throw new Error(body.message || 'github_user_fetch_failed');
  }
  return { login: body.login, id: body.id, avatar_url: body.avatar_url };
}
