# GitHub OAuth setup for Merlin

Use this to enable the live "Connect" flow for GitHub in the Merlin shell
(`web/`). Unlike Google Drive's setup, this is a real interactive browser
redirect flow, not a one-time CLI-generated refresh token.

## 1. Register a GitHub OAuth App

1. Go to https://github.com/settings/developers -> OAuth Apps -> New OAuth App
2. Application name: e.g. "Merlin (dev)"
3. Homepage URL: `http://localhost:3030` (use your deployed URL for a
   production app)
4. Authorization callback URL:
   `http://localhost:3030/api/merlin/connected-sources/github/callback`
   (must match exactly, including scheme/port)
5. Register the app, then generate a Client Secret

## 2. Local `.env`

```bash
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_OAUTH_REDIRECT_URI=http://localhost:3030/api/merlin/connected-sources/github/callback
```

All three are required — if any are missing, clicking "Connect" on GitHub
in the Merlin shell redirects back with `?connect_error=github_not_configured`
instead of attempting the OAuth handshake.

## 3. Flow

1. User clicks "Connect" on the GitHub card in `/merlin` (`web/src/ConnectedAppsList.tsx`)
2. Browser navigates to `GET /api/merlin/connected-sources/github/authorize`
   (`src/merlin/routes/merlinGithubOAuthRoutes.ts`), which redirects to
   GitHub's consent screen with a short-lived CSRF `state` value
3. On approval, GitHub redirects to `GET .../github/callback`, which
   exchanges the code for an access token (`src/githubOAuthClient.ts`),
   fetches the authenticated GitHub user, and stores the connection via
   `upsertMerlinConnectedSource` + `upsertMerlinConnectedSourceOAuthTokens`
   (`src/merlin/connectedSourceRuntime.ts`)
4. Browser is redirected back to `/merlin?connected=github`

## Notes

- Tokens are stored in plaintext in the local sqlite file
  (`merlin_connected_sources.oauth_access_token`), matching this repo's
  existing security posture for credentials (Google's refresh token is
  also plaintext in `.env`) — there is no encryption-at-rest layer here.
- Tokens are never included in any API response — `GET /api/merlin/shell`
  and `listMerlinConnectedSources` only ever return `external_account_login`
  for display, never the token columns.
- The CSRF `state` map is in-memory and single-process. If this app is ever
  deployed across multiple instances, a shared store (Redis, DB-backed)
  would be needed instead.
- Do not commit `.env` or any token values.
