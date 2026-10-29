# Hunsterverse API

The website and the Discord bot talk to one Spring Boot service. Everything the site shows about
guilds, hunters, the catalog and the Hunting Road comes from it, and the account and admin pages use
the same service with a signed-in token.

- Base URL: `https://api.hvmhfz.eclipseforge.xyz`
- Health: `GET /actuator/health` returns `{"status":"UP"}`.
- All responses are JSON unless noted. Times are ISO 8601 in UTC (`2026-10-29T04:58:27Z`).
- CORS: public endpoints allow any origin. Account and admin endpoints expect the `Authorization`
  header and are not meant for browsers on other origins.

## Authentication

Two sign-in routes exist. Both return a signed JWT (7 days) that identifies the account; there is no
API key and no way to ask for another account's data.

### From a program (no captcha)

```bash
curl -s https://api.hvmhfz.eclipseforge.xyz/api/auth/signin \
  -H 'Content-Type: application/json' \
  -d '{"username":"YourGameName","password":"your-password","token":""}'
```

```json
{"accessToken":"eyJhbGciOiJIUzI1NiJ9...","id":12345,"roles":["ROLE_USER"],"tokenType":"Bearer"}
```

Use it on every account request:

```bash
curl -s https://api.hvmhfz.eclipseforge.xyz/api/account \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9..."
```

### From the website (Cloudflare Turnstile)

`POST /api/auth/signinweb` takes the same body plus the Turnstile response in `token`. The site's
sign-in form does this for you. `POST /api/auth/signup` and `PUT /api/auth/passwordreset` work the
same way for registration and password resets.

The token is a JWT: header, payload (`sub` = account name, `roles`, `exp`), signature. The server
checks the signature and the role on every request, so editing the payload only breaks it. Your
account id is never taken from the URL; `/api/account` reads it from the token.

Status codes: `401` no or expired token, `403` signed in but not allowed (for example a non-admin
calling `/api/admin/...`), `429` too many attempts on sign-in.

## Public endpoints

No token. Safe to call from anywhere.

| Method and path | Query | Returns |
| --- | --- | --- |
| `GET /api/public/summary` | | server totals: hunters, guilds, characters online |
| `GET /api/public/guilds` | `q`, `sort` (`rp`), `page`, `size` | paged guild summaries |
| `GET /api/public/guilds/{id}` | | one guild with roster and board |
| `GET /api/public/hunters` | `q`, `sort` (`name`, `hr`, `gr`, `last`), `page`, `size` | paged hunter summaries |
| `GET /api/public/hunters/{id}` | | one hunter: characters, guild, playtime, hunts |
| `GET /api/public/catalog/items` | `q`, `page`, `size` | item catalog |
| `GET /api/public/catalog/equipment` | `slot` (`melee`, `ranged`, `head`, `chest`, `arms`, `waist`, `legs`), `q`, `page`, `size` | equipment catalog |
| `GET /api/public/worlds` | | worlds and their player counts |
| `GET /api/public/monsters` | `limit` (default 300) | monster kill counts |
| `GET /api/public/leaderboards/hunts` | `period` (`week`, `lastweek`, `month`, `lastmonth`, `all`), `board` (`hunters`, `guilds`, `monsters`, `rp`) | one leaderboard |
| `GET /api/public/road/leaderboard` | `rotation` (`current`, `original`, or a cycle number), `mode` (`open`, `solo`), `limit` | Hunting Road board |
| `GET /api/public/road/history` | | every Road that has gone live |
| `GET /api/public/search` | `q` | mixed search: hunters, guilds, monsters |
| `GET /api/public/events` | | current and upcoming events |

Example:

```bash
curl -s 'https://api.hvmhfz.eclipseforge.xyz/api/public/hunters?sort=hr&page=0&size=10'
```

The Road board is ranked by the highest floor reached in one run during that rotation, then by who
reached it first. Each entry carries the floor, when it was reached, how many floors were recorded in
the rotation and the Road point balance at that floor. `rotation` records carry `sha`, the sha256 of
the Road data file, which is the map's permanent id.

## Account endpoints

Bearer token required. The server resolves the account from the token; there is no id parameter.

| Method and path | Returns |
| --- | --- |
| `GET /api/account` | account summary: name, id, roles, characters |
| `GET /api/account/characters` | the account's characters |
| `GET /api/account/guilds` | guilds the characters belong to |
| `GET /api/account/discord` | linked Discord account, if any |
| `GET /api/account/distributions` | gift lists: global ones plus those targeted at your characters, with claim counts |
| `GET /api/account/characters/{id}/storage` | one character's item box and pouch (decoded, numbers only) |
| `GET /api/account/characters/{id}/hunts` | hunt history for one character |

Every one of these answers `401` without a valid token, and `404` when the character id belongs to
someone else. Save blobs are decoded on the server; the API never returns raw blobs.

```bash
TOKEN=$(curl -s ... /api/auth/signin | jq -r .accessToken)
curl -s https://api.hvmhfz.eclipseforge.xyz/api/account/distributions \
  -H "Authorization: Bearer $TOKEN"
```

## Admin endpoints

Bearer token with `ROLE_ADMIN` (some with `ROLE_MODERATOR`). The website's admin page uses these; the
server enforces the role on every call.

### Server tools

| Method and path | Does |
| --- | --- |
| `GET /api/admin/ops/services` | state of erupe, the API and the bot, restart counter, players |
| `GET /api/admin/ops/services/{service}/logs?lines=200&errors=false` | recent log lines, secrets and player IPs masked |
| `POST /api/admin/ops/services/{service}/restart` | restarts api or bot at once; for `erupe` it schedules the warned restart: 10 minutes of Discord and in-game warnings, the bot shows the countdown, then the swap and restart. The call returns `restart=scheduled (...)` at once. One restart per service per two minutes. |
| `GET /api/admin/ops/audit?max=500` | newest-first admin audit entries: `at`, `account`, `action`, `target`, `result` |

The audit file records every admin action: restarts, role changes, user chat flags, gifts, Hunting
Road cycles and entries, session cleanups. `max` is clamped to 1000.

### Users and roles

| Method and path | Does |
| --- | --- |
| `GET /api/admin/users?q=&page=0&size=25` | paged accounts with roles, characters, last login, Discord link and chat flags |
| `POST /api/admin/users/{id}/flags` | set `{"op":true,"timer":false}` chat flags |
| `GET /api/admin/roles` | role list |
| `POST /api/admin/roles` | `{"username":"Name","role":"ROLE_MODERATOR","grant":true}`; nobody can remove their own admin role and the last admin cannot be removed |

### Gifts

| Method and path | Does |
| --- | --- |
| `GET /api/dist/all` | all gift lists |
| `POST /api/dist/createDist` | create a gift list (admin or moderator) |

### Hunting Road

| Method and path | Does |
| --- | --- |
| `GET /api/admin/road/cycles` | cycles with entries and state |
| `POST /api/admin/road/cycles` | create a cycle |
| `PUT /api/admin/road/cycles/{id}` | edit a cycle |
| `POST /api/admin/road/cycles/{id}/close` | close submissions and open voting |
| `POST /api/admin/road/cycles/{id}/approve` | approve the winner |
| `POST /api/admin/road/cycles/{id}/winner` | `{"entryId":12}` override the winner |
| `POST /api/admin/road/entries/{id}/hide` | hide an entry; also `unhide`, `disqualify`, body `{"reason":"..."}` |
| `POST /api/admin/road/pause` | `{"paused":true}` pause or resume the rotation |

Player-facing Road endpoints: `GET /api/road/entries`, `POST /api/road/entries`, `PUT /api/road/entries/{id}`
and the vote routes under `/api/road`. They need an account token; the rules are on the site's
Hunting Road page.

### Deploy hook (not a user endpoint)

`GET /api/road/deploy/next` and `POST /api/road/deploy/{cycleId}/result` are called by the Road deploy
system on the game host with the `X-Road-Deploy-Token` header. They are not reachable with a normal
account token.

## Errors

Errors are `{"message":"..."}` with these codes:

- `400` bad input (missing field, wrong type, an id that cannot be used)
- `401` missing or expired token
- `403` wrong role, or a character that is not yours
- `404` unknown id or unknown path
- `409` conflicts such as "already voted"
- `429` rate limit (sign-in and the public endpoints)
- `502` an upstream tool (systemd, the game server) failed

## Rate limits and caching

Public responses are cached for 30 seconds, so polling faster than that returns the same data.
Sign-in and the public endpoints have a small request limit per client; back off on `429` rather than
retrying in a loop.

## Notes for bot authors

The Discord bot signs in with its own account through `POST /api/auth/signin`, keeps the token and
renews it when it gets a `401`. For the player-count status it reads `GET /api/public/worlds` or its
own `/api/sessions/worldstats` with an admin token. Message relays and slash commands live in the
bot's own repository; the API only exposes the data above.
