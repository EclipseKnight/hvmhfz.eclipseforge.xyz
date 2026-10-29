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

No token, cached 30 seconds unless stated. Paged endpoints return {items, page, size, total}; page starts at 0 and size is clamped to 1 to 100.

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

## Your account

Send Authorization: Bearer <token>. The account comes from the token; there is no id parameter. No raw save blobs are returned, only decoded numbers.

| Path | Parameters | Returns |

| --- | --- | --- |

| GET /api/account | none | account: id, name, roles, characters |

| GET /api/account/characters | none | your characters |

| GET /api/account/guilds | none | guilds your characters belong to |

| GET /api/account/discord | none | linked Discord id and name, or null |

| GET /api/account/distributions | none | gift lists: global gifts plus those targeted at your characters, with accepted counts |

| GET /api/account/characters/{id}/storage | id: one of your character ids | zenny, G zenny, CP, item box, pouch, warehouse, stamps, house |

| GET /api/account/characters/{id}/hunts | id: one of your character ids | hunt history for that character |

A character id that is not yours answers 404 (not another account's data). A missing or expired token answers 401.

```
TOKEN=$(curl -s https://api.hvmhfz.eclipseforge.xyz/api/auth/signin \
  -H 'Content-Type: application/json' \
  -d '{"username":"YourGameName","password":"your-password","token":""}' | jq -r .accessToken)

curl -s https://api.hvmhfz.eclipseforge.xyz/api/account/distributions \
  -H "Authorization: Bearer $TOKEN"
```

## Server tools (admin and moderator)

Bearer token with ROLE_ADMIN or ROLE_MODERATOR. The server checks the role on every call; the buttons on the site are only a convenience. Every action here is written to the audit log with the account that did it.

| Path | Parameters | Does |

| --- | --- | --- |

| GET /api/admin/ops/services | none | state of erupe, api and bot: state, since, restarts, players |

| GET /api/admin/ops/services/{service}/logs | service: erupe, api, bot; lines (200 default, 1 to 500); errors (false default; true filters WARN/ERROR) | recent log lines, secrets and player IPs masked |

| POST /api/admin/ops/services/{service}/restart | service: erupe, api, bot | api and bot restart at once. erupe schedules the warned restart: 10 minutes of Discord and in-game messages, the bot status counts down, then the swap and restart. Answers restart=scheduled (...). One restart per service every two minutes (429). |

| GET /api/admin/ops/audit | max (50 default, 1 to 1000) | newest-first audit entries: at, account, action, target, result |

The audit log records every admin action (restarts, roles, chat flags, gifts, Road changes, session cleanups) and every signed-in request that changes something outside the admin pages (Road entries and votes, Discord link and unlink, save imports). Public reads are not logged.

## Users, roles and gifts (admin)

Users and roles need ROLE_ADMIN. Gifts need ROLE_ADMIN as well.

### Accounts

| Path | Parameters | Does |

| --- | --- | --- |

| GET /api/admin/users | q (name search), page (0), size (25, max 100) | paged accounts: id, name, roles, characters, last login, Discord link, chat flags |

| POST /api/admin/users/{id}/flags | id: account id; body {"op":true,"timer":false} (either or both; null leaves it) | sets the in-game chat flags |

| GET /api/admin/roles | none | role list |

| POST /api/admin/roles | body {"username":"Name","role":"ROLE_MODERATOR","grant":true} | grants or removes a role. Nobody can remove their own admin role; the last admin cannot be removed. |

### Gift lists (distributions)

A gift is one entry in one of the game's gift lists. With no characters it goes to every character; with characters, Erupe stores one copy per character. The gift is in the game's list as soon as the call returns, so the panel asks for confirmation first.

| Path | Parameters | Does |

| --- | --- | --- |

| GET /api/admin/distributions | none | every gift: id, type, typeName, eventName, description, deadline, ended, timesAcceptable, targets, rank limits, items, accepted, claimants |

| GET /api/admin/distributions/options | none | lists {}, itemTypes {}, itemTypesWithId [], maxCharacters (100). The panel builds its selects from this, so it always matches the server. |

| POST /api/admin/distributions | body: NewDistribution (see below) | 201 {id, ids[]}; one id per targeted character, or one for all |

| POST /api/admin/distributions/{id}/end | id: gift id | 204; ends the gift early |

### NewDistribution fields

| Field | Type | Required | Rules |

| --- | --- | --- | --- |

| type | integer | yes | gift list: 0 Bought, 1 Event, 2 Compensation, 4 Promo, 7 Event item, 8 Promo item, 9 Subscription item |

| eventName | string | yes | 1 to 60 characters; the client shows ~C05... colour codes |

| description | string | no | up to 600 characters; same colour codes |

| deadline | ISO 8601 instant | no | must be in the future; null means no end |

| timesAcceptable | integer | yes | 1 to 255, how many times each character can claim it |

| characterIds | array of integers | no | up to 100 character ids; omit or [] for every character |

| characterId | integer | no | single-character form; both fields are merged without repeats |

| minHr, maxHr, minSr, maxSr, minGr, maxGr | integer | no | 1 to 999; a minimum above its maximum is refused |

| items | array of objects | yes | 1 to 100 entries; see below |

### Each item in items[]

| Field | Type | Rules |

| --- | --- | --- |

| itemType | integer 0 to 31 | which kind of thing: 0 Legs, 1 Head, 2 Chest, 3 Arms, 4 Waist, 5 Melee weapon, 6 Ranged weapon, 7 Item, 8 Furniture, 10 Zenny, 14 Tore points, 15 Poogie outfit, 16 Restyle points, 17 N points, 18 Goocoo outfit, 19 Gacha coins, 20 Trial gacha coins, 21 Frontier points, 23 Guild RP, 30 Item box pages, 31 Equipment box pages. Types the client ignores are refused, so a gift cannot silently give nothing. |

| itemId | integer 0 to 65535 | required for types that name a thing (0 to 8, 15, 18): the catalog id (for type 7 the item's hex id as a number, for example BF39 -> 14783). Poogie outfits are 1 to 31. Not used by the amount types (10, 14, 16, 17, 19 to 21, 23, 30, 31). |

| quantity | integer 1 to 999999 | how much. For items keep it at 99 or less so the client stacks it the way the game does; Zenny and points accept larger values. |

### Example: a gift for everyone

```
curl -s -X POST https://api.hvmhfz.eclipseforge.xyz/api/admin/distributions \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "type": 1,
    "eventName": "~C07Autumn supply drop",
    "description": "~C05Enjoy the new Hunting Road!",
    "deadline": "2026-11-12T23:59:59Z",
    "timesAcceptable": 1,
    "minHr": 1,
    "maxHr": 999,
    "items": [
      {"itemType": 7, "itemId": 14783, "quantity": 10},
      {"itemType": 10, "quantity": 100000}
    ]
  }'
```

That gives every character 10 of item 14783 and 100,000 Zenny, claimable once, until 12 November. Add characterIds: [12, 44] to target only those characters. The answer is 201 {"id":123,"ids":[123,124,...]}.

Item ids come from GET /api/public/catalog/items (its id is hex; the API wants the same number the game uses) and equipment ids from GET /api/public/catalog/equipment with the matching slot.

## Hunting Road admin (admin)

One rotation at a time. Times are ISO 8601 instants, UTC.

| Path | Body | Does |

| --- | --- | --- |

| GET /api/admin/road/cycles | none | cycles with state, times, entries and votes |

| POST /api/admin/road/cycles | {"submitOpens":"2026-11-01T00:00:00Z","submitCloses":"2026-11-08T00:00:00Z","voteCloses":"2026-11-10T00:00:00Z"} | creates a cycle |

| PUT /api/admin/road/cycles/{id} | same body | edits the times of an open cycle |

| POST /api/admin/road/cycles/{id}/close | none | closes submissions and opens voting |

| POST /api/admin/road/cycles/{id}/approve | none | approves the voted winner for deploy |

| POST /api/admin/road/cycles/{id}/winner | {"entryId":12} | overrides the winner |

| POST /api/admin/road/entries/{id}/hide | {"reason":"..."} (optional) | hides an entry |

| POST /api/admin/road/entries/{id}/unhide | same | restores it |

| POST /api/admin/road/entries/{id}/disqualify | same | disqualifies it |

| POST /api/admin/road/pause | {"paused":true} or {"paused":false} | pauses or resumes the rotation |

### Player Road endpoints (any signed-in account)

| Path | Body / query | Does |

| --- | --- | --- |

| GET /api/road/pool | none | the shared base pool |

| GET /api/road/cycle | none | the current cycle and your entry |

| POST /api/road/check | {"edits":{...}} | validates edits without saving |

| GET /api/road/entries | none | entries for the open cycle |

| GET /api/road/entries/{id} | none | one entry |

| POST /api/road/entries | {"name":"...","description":"...","characterId":12,"edits":{...}} | submits an entry |

| PUT /api/road/entries/{id} | same body | edits your entry while submissions are open |

| POST /api/road/votes | {"entryId":12} | votes for an entry |

| DELETE /api/road/votes/{entryId} | none | removes your vote |

| GET /api/road/results?cycle=3 | cycle optional | results for a closed cycle |

| GET /api/road/rewards | none | your Road rewards |

The rules (what edits are allowed, one entry per account, vote limits) are described on the Hunting Road page and enforced by the server.

## Authentication rules and the audit trail

Every endpoint except sign-in, sign-up, password reset, the public reads and the Road deploy hook requires an account token. The deploy hook uses its own X-Road-Deploy-Token header and is only reachable from the game host.

| Area | Auth | Audited |

| --- | --- | --- |

| /api/auth/** | none (rate limited) | no |

| /api/public/** | none | no |

| /api/road/deploy/** | X-Road-Deploy-Token | deploy result only |

| /api/account/** | account token | no (reads) |

| /api/road (entries, votes) | account token | yes, every successful change |

| /api/users, /api/characters/import | account token | yes, every successful change |

| /api/admin/ops/** | ADMIN or MODERATOR | yes, with action and target |

| /api/admin/users, roles, road, distributions | ADMIN | yes, with action and target |

Audit entries are one JSON line each: at, account, action, target, result. Admin actions carry a readable action (restart, role grant, gift create, road approve...); other signed-in changes are recorded as api POST/PUT/DELETE with the path. The newest 1000 are served by GET /api/admin/ops/audit and shown under Audit on the admin page.
