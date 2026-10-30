# RNGDLE API

![NPM Version](https://img.shields.io/npm/v/%40mimi_py%2Frngdle) ![NPM Downloads](https://img.shields.io/npm/dy/%40mimi_py%2Frngdle)

Node.js client for [rngdle.com](https://www.rngdle.com).
This is an API Client used to interact with RNGDLE to fetch rolls, friends, and related data from RNGdle.

**Unofficial** This project is not affiliated with or RNGdle. Their API can change without notice which may cause this package to break when that happens. Please respect [RNGDLE’s terms of use](https://rngdle.net/terms).

- Fetch a user's full roll history
- Search users
- Fetch friends list and friend requsts
- Accept or Send friend requests (must have session cookie)
- See today's roll for the logged in user

## Installation

Install using npm

```bash
npm install @mimi_py/rngdle
```

## Usage/Examples

```typescript
// Imports
import { RngdleClient } from '@mimi_py/rngdle';

// Public data — cookie optional
const client = new RngdleClient();
const { rolls, bestRoll, latestRoll } = await client.getRolls('mimi_py');

// Authenticated routes — pass your session cookie
const authed = new RngdleClient(process.env.RNGDLE_COOKIE);
const requests = await authed.getFriendRequests();
```

### How to get your session token for auth required endpoints:

- Open the [Friends](https://www.rngdle.com/friends) tab.
- Press Ctrl + Shift + i simultaneously (or right click -> inspect if your browser does not support the shortcut).
  ![descriptor](https://i.postimg.cc/3JYPhDF1/image.png)
- Open the Network Tab from the top of the inspector.
- Refresh the page, you will see a `Fetch` request `get-session`.
  ![descriptor](https://i.postimg.cc/9Mqj45DZ/image.png)
- Open the fetch requests Headers, and look for `Cookies`.
- Right click and copy the value.

## API Reference

only pass in the session cookie for methods that have "auth" as a requirement

```bash
new RngdleClient(sessionCookie?)
```

| Method                           | Auth | Description                                                |
| :------------------------------- | :--- | :--------------------------------------------------------- |
| `getRolls(username)`             | No   | Gets all rolls for a profile (rolls, latestRoll, bestRoll) |
| `fetchUsers(username)`           | Yes  | Finds Users                                                |
| `getFriends()`                   | Yes  | Friends List                                               |
| `getFriendRequests()`            | Yes  | Received Friend Requests                                   |
| `getTodayRoll()`                 | Yes  | Logged in user's roll for today                            |
| `sendFriendRequest(username)`    | Yes  | Sends a friend request to another user                     |
| `acceptFriendRequest(requestId)` | Yes  | Accepts a friend request from another user                 |
| `acceptAllFriendRequests()`      | Yes  | Accepts all friend requests                                |

#### Notes:

- acceptFriendRequest requires the request id from getFriendRequests(), not a user’s account id.

## Disclaimer

This tool scrapes and calls RNGDLE’s private endpoints. This is meant for personal use. We are not responsible if your usage causes any account bans. Please be respectful when utilizing this tool as to not spam/overload the RNGDLE services
