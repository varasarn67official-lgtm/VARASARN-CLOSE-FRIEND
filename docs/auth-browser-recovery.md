# Google sign-in and embedded browsers

Google remains the only sign-in method. LINE and Instagram can use embedded
browsers that Google does not allow for OAuth. The website cannot override that
restriction. Recognized LINE, Instagram, Facebook and Messenger browsers get
the easiest available browser-opening route immediately, without an extra
Google button that would only open help. LINE's primary button uses its
documented `openExternalBrowser=1` parameter. Other recognized Android app
browsers get a user-gesture Chrome intent with a clean website fallback URL.
The host app may refuse the launch, so app-menu instructions remain available.
On iPhone, Instagram and the other Meta apps get two visible menu steps:
tap the app's menu, then choose Open in browser / Open in Safari. No undocumented
iOS launch schemes are used. Copying is under a secondary disclosure, with a
selectable input if clipboard access fails. Ordinary browsers keep their
Google button without app-browser instructions. An auth failure shows a concise notice above
one Google retry action; the browser guide stays hidden in ordinary browsers
so an unconfirmed failure is not presented as an embedded-browser problem.
Session restoration and pending sign-in show progress and prevent overlapping
Google attempts. A failed attempt restores focus to the retry button. Existing
LINE support is linked from the error state, without requiring sign-in. Detection
uses named app signatures, never generic iOS WebView guesses.

Browser-opening buttons carry the non-secret `continue=google` marker. The
destination consumes it before auth work, restores any existing session, and
starts Google once if still signed out in a normal browser. If the link stays
in a recognized app browser, it shows guidance without attempting OAuth.
Reloading after a failure does not automatically retry. App-menu opening and
copying lead to the normal Google button. Copied links contain only this
website's origin, never an OAuth verifier or other URL state. Sessions do not
transfer between an app browser and Safari/Chrome; the destination starts its
own auth flow.

## Same-origin auth endpoint

`api/auth.ts` serves the existing Neon Auth instance through `/api/auth/*`
using the installed SDK's server toolkit. Browser requests and HttpOnly,
Secure, SameSite=Lax cookies stay on the website's own origin. This reduces
cross-site cookie dependence; it does not make Google's OAuth work in a
blocked embedded browser. The existing frontend and database authorization
remain in use.

Only Google social sign-in, session restoration, token retrieval and sign-out
are exposed. Mutations require the same Origin as the request URL. The Google
callback and error landing are constrained to that origin. API responses are
never cached. Auth SDK logs are disabled on the server; our error logs contain
only an allowlisted route, status, fixed code and random support reference.
They never include exception messages, request URLs, bodies, tokens or user
data. The reference is returned in `X-Auth-Reference` for a failing request.
Browser console diagnostics contain only stage, status, browser category and
fixed failure category.

The browser SDK still exchanges `neon_auth_session_verifier` through
`get-session` after Google's redirect, using the challenge cookie on this
website's origin. The proxy preserves that query parameter, cookie expiry and
deletion, and `set-auth-jwt`. It bypasses the server session-data cache on
`get-session`, because the cached response can omit the JWT needed by the
existing Data API adapter. A signed-in upstream session without that JWT is
reported as a failure instead of sending an opaque session token to the Data
API.

## Enable on a preview first

Configure these Vercel environment variables for the preview deployment:

| Variable | Value |
| --- | --- |
| `NEON_AUTH_BASE_URL` | Existing Neon Auth URL, including its path; same instance as `VITE_NEON_AUTH_URL` |
| `NEON_AUTH_COOKIE_SECRET` | Random secret of at least 32 characters, server-only; generate with `openssl rand -base64 32` |
| `VITE_AUTH_PROXY_ENABLED` | `true` |
| `VITE_NEON_DATA_API_URL` | Existing Data API URL |

Keep the exact preview origin trusted by Neon Auth and permitted by Data API
CORS. Use HTTPS: cookies have the `Secure` flag. `vite dev` and `vite preview`
serve the frontend only, so use a Vercel preview (or Vercel's local function
runtime over HTTPS) to exercise the server endpoint. The dev mock remains a
UI fixture, not proof of real auth.

Rebuild when changing `VITE_AUTH_PROXY_ENABLED`. With the flag absent or
false, the existing direct Neon flow remains selected. If the flag is true
but server configuration is missing, the endpoint returns 503; it never
silently switches to direct auth. Existing direct-auth cookies belong to the
Neon origin, so users should expect to sign in again when switching to the
proxy. Account IDs and application rows are not migrated.

## Release acceptance

On actual phones, check LINE and Instagram on both iOS and Android, plus
Safari and Chrome:

1. Open the shared link while signed out. Confirm guidance, readable Thai
   text, keyboard focus and usable controls at narrow widths.
2. In LINE, try the external-browser button. On Android, try the Chrome
   button. Confirm Google starts once in the destination browser, or an
   existing session opens the app directly. On Instagram iPhone, use the
   two menu steps, then the Google button. Try secondary recovery and copying
   when the host app blocks launching or its browser menu is unavailable.
3. Complete Google sign-in, return to the catalog, then reload and reopen
   the site. Confirm session restoration and access to the correct account's
   reviews and timetable. Check the Data API uses a JWT, not an opaque token;
   never save or share its value.
4. Sign out. Confirm protected content disappears and remains unavailable
   after reload. Check that cookies are deleted on the website's origin.
5. Check cancellation/error returns, blocked clipboard access, and a failed
   auth request. Recognized embedded browsers should keep their guidance;
   ordinary browsers should show error feedback and a clear retry without
   app-browser instructions. Technical messages should stay hidden, progress
   should be announced, and manual retry should work without overlapping attempts.
6. When an embedded Google flow is blocked, confirm the external-browser
   recovery succeeds. Record the failure stage, HTTP status/code and support
   reference only; never capture OAuth query strings or credentials.

Local automated tests cover the real SDK proxy contract and browser recovery
behavior. They do not establish real-device Google/LINE/Instagram acceptance.

References: [Google embedded-browser restriction](https://developers.google.com/identity/protocols/oauth2/native-app#disallowed_useragent),
[LINE external-browser parameter](https://developers.line.biz/en/docs/messaging-api/using-line-url-scheme/#opening-url-in-external-browser),
[Neon adapter toolkit](https://github.com/neondatabase/neon-js/blob/main/packages/auth/BUILDING-AN-ADAPTER.md),
[Vercel functions](https://vercel.com/docs/functions/runtimes/node-js),
[Android intent links and fallback](https://developer.chrome.com/docs/android/intents).
