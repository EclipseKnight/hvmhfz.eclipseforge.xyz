# Hunsterverse API

The website and the Discord bot talk to one Spring Boot service. Base URL `https://api.hvmhfz.eclipseforge.xyz`; health at `/actuator/health`; times are ISO 8601 UTC.

This document has a public half (sign-in and the public reads, safe to share) and a private half (account, admin, Road tools), shown on the site only to moderators and admins. The server checks the role regardless of this page.

## Contents

- [Signing in](#signin)
- [Public endpoints](#public)
- [Errors, limits and caching](#errors)
- [Your account](#account)
- [Server tools (admin and moderator)](#admin-ops)
- [Users, roles and gifts (admin)](#admin-users)
- [Hunting Road admin (admin)](#admin-road)
- [Authentication rules and the audit trail](#auth-audit)

## Signing in

Two routes return the same signed token, valid 7 days. The token names the account; no endpoint takes an account id from the caller, so one token cannot read another account's data. Sign-in itself is one of the few routes that do not need a token.

### POST /api/auth/signin (programs, no captcha)

Body fields: username (game account name), password (plain, over HTTPS), token (empty string; the captcha answer is only used by the web route).

```
curl -s https://api.hvmhfz.eclipseforge.xyz/api/auth/signin \
  -H 'Content-Type: application/json' \
  -d '{"username":"YourGameName","password":"your-password","token":""}'
```

```
{"accessToken":"eyJhbGciOiJIUzI1NiJ9...","id":12345,"roles":["ROLE_USER"],"tokenType":"Bearer"}
```

Send it on every request that needs an account: Authorization: Bearer <accessToken>. The token is a JWT: sub is the account name, roles lists ROLE_USER / ROLE_MODERATOR / ROLE_ADMIN, exp is the expiry. The server checks the signature and the role on every request; editing the payload breaks the signature.

### POST /api/auth/signinweb (the website)

Same body, but token carries the Cloudflare Turnstile answer. The site's form does this for you. Wrong or missing captcha answers are refused; repeated failures are rate limited (429).

### Registration and password reset

POST /api/auth/signup takes username, password and an optional role (ignored for new accounts, which are always ROLE_USER). PUT /api/auth/passwordreset takes username, password and discordId for accounts that linked Discord. Both are rate limited.

| Header | Value |

| --- | --- |

| Authorization | Bearer <accessToken> |

| Content-Type | application/json on requests with a body |

Status codes: 400 bad body, 401 missing or expired token, 403 signed in but not allowed, 429 too many sign-in attempts.

## Public endpoints

No token, cached 30 seconds unless stated. Paged endpoints return {items, page, size, total}; page starts at 0 and size is clamped to 1 to 100. Every other route, including the account and admin pages, needs an account token: sign in as described above and send it as a bearer token.

| Path | Parameters | Returns |

| --- | --- | --- |

| GET /api/public/summary | none | counts: hunters, guilds, characters, online players |

| GET /api/public/guilds | q (search, case-insensitive), sort (default rp), page (0), size (30, max 100) | paged guild summaries |

| GET /api/public/guilds/{id} | id: guild id | one guild: name, rank, points, roster, board |

| GET /api/public/hunters | q, sort (hr default, name, gr, last), page, size (30, max 100) | paged hunter summaries |

| GET /api/public/hunters/{id} | id: character id | one hunter: name, HR, GR, weapon, guild, playtime, hunts |

| GET /api/public/catalog/items | q, page, size (40, max 100) | paged items: id (hex), name, type, icon |

| GET /api/public/catalog/equipment | slot (melee default, ranged, head, chest, arms, waist, legs), q, page, size (40) | paged equipment |

| GET /api/public/worlds | none | worlds: name, description, players, capacity |

| GET /api/public/monsters | limit (300 default, 1 to 300) | monster kill totals |

| GET /api/public/leaderboards/hunts | period (week default, lastweek, month, lastmonth, all), limit (100 default, 1 to 100) | period, from, to, resetsAt, hunters[], guilds[], monsters[] |

| GET /api/public/road/leaderboard | rotation (current default, original, or a cycle number), mode (open default, solo), limit (100 default, 1 to 100) | rotation, rotations[], tracking, hunters, entries[] |

| GET /api/public/road/history | none | every Road that has gone live, newest first |

| GET /api/public/search | q (required in practice) | hunters, guilds and monsters matching q |

| GET /api/public/events | none | current and upcoming events |

The hunt board scans the whole kill log, so it is cached for 5 minutes per period and size. Weeks start Monday 00:00 UTC and months on the 1st, so week resets every Monday.

### Road leaderboard entry fields

| Field | Meaning |

| --- | --- |

| rank | 1-based position on this board |

| characterId, name, guildName, gr | who reached the floor |

| floor | highest floor reached in one run during the rotation |

| reachedAt | when that floor was first reached (ISO 8601 UTC) |

| floorsClimbed | how many floors were recorded for that hunter in the rotation |

| points | Road point balance at that floor, or null when it was not recorded |

rotation.sha is the sha256 of the Road data file, the map's permanent id. Rotations are listed in rotations[], newest first.

## Errors, limits and caching

Errors are {"message":"..."}. 400 bad input (missing field, out of range, a minimum above its maximum), 401 missing or expired token, 403 wrong role or a character that is not yours, 404 unknown id, 409 conflicts such as an existing vote, 429 rate limit, 502 an upstream tool failed.

Public reads are cached 30 seconds; hunt boards 5 minutes per period and size. Sign-in and the public endpoints are rate limited per client: back off on 429 instead of retrying in a loop.

Paged endpoints take page (0-based) and size (1 to 100). Sizes above the maximum are clamped, not refused.

## Private endpoints

The account, admin and Road endpoint reference needs a moderator or admin account: sign in on the site and it loads from `GET /api/docs/private`, which the server only answers for those roles. The same reference is in the API repository at `docs/api-private.md`.
