const ORIGIN = "https://www.rngdle.com";
const ROLL_PAGE_SIZE = 500;
const MAX_ROLL_PAGES = 100;
const SEARCH_RETRY_FALLBACK_MS = 60_000;
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0";

const ACTION_NAMES = [
  "sendFriendRequest",
  "acceptFriendRequest",
  "searchUsersForFriend",
] as const;

// next rewrites these hashes on every deploy, so they get read off the live bundle
const SERVER_ACTION =
  /createServerReference\)\("([a-f0-9]+)"[^"]*"([A-Za-z]+)"/g;

const FRIENDS_TREE = encodeURIComponent(
  JSON.stringify([
    "",
    {
      children: [
        "friends",
        { children: ["__PAGE__", {}, null, null] },
        null,
        null,
        true,
      ],
    },
    null,
    null,
    true,
  ]),
);

/** A badge on the logged-in user's roll today. `family` is omitted when the badge stands alone. */
export type RollBadge = {
  id: string;
  label: string;
  description: string;
  score: number;
  emoji: string;
  isScoring: boolean;
  isNew: boolean;
  family?: string;
};

/** Today's roll from `/api/home`, under `viewer.lastRoll`. */
export type TodayRoll = {
  number: number;
  badges: RollBadge[];
  totalScore: number;
  poem: string | null;
};

/** One daily roll. */
export type Roll = {
  id: string;
  number: number;
  totalScore: number;
  badgeCount: number;
  rolledAt: string;
  heartCount: number;
  activityId: string;
  poem: string | null;
};

/** Someone on rngdle. */
export type User = {
  id: string;
  displayName: string;
  displayNameColor: string;
  favoriteBadgeEmojis: string[];
};

/** A pending friend request. `id` is the friendship id, not the user's id. */
export type FriendRequest = {
  id: string;
  createdAt: string;
  user: User;
};
/** A user from the friends search box. `id` is what `sendFriendRequest` wants. */
export type SearchedUser = User & {
  friendshipStatus: "none" | "pending_sent" | "pending_received" | "friends";
};

/** Someone on your friends list. `id` is their account id. */
export type Friend = {
  id: string;
  displayName: string;
  displayNameColor: string;
  favoriteBadgeEmojis: string[];
  friendsSince?: string;
  stats?: {
    totalEp: number;
    rollCount: number;
  };
};

/** Every roll for a profile. `latestRoll` is whatever the api returned first. */
export type UserRolls = {
  rolls: Roll[];
  latestRoll: Roll | null;
  bestRoll: Roll | null;
};

/** What a server action returned. A 200 does not mean this succeeded. */
export type ActionResult = {
  success: boolean;
  error?: string;
};

type RollPage = {
  rolls: Roll[];
  hasMore: boolean;
};

type ActionName = (typeof ACTION_NAMES)[number];

/**
 * Client for rngdle.com.
 * Rolls are public. Friend routes need the cookie from a logged-in browser.
 */
export class RngdleClient {
  private sessionCookie: string;
  private actionIdsCache: Promise<Map<string, string>> | null = null;

  constructor(sessionCookie = "") {
    this.sessionCookie = normalizeCookie(sessionCookie);
  }
  /** Search users by name. Same call as the box on /friends. */
  async fetchUsers(username: string): Promise<SearchedUser[]> {
    const query = username.trim();
    if (!query) throw new Error("username is required");

    const value = await this.callAction(
      "/friends",
      "searchUsersForFriend",
      FRIENDS_TREE,
      query,
    );
    if (!isRecord(value)) throw new Error("rngdle user search didn't look right");
    if (value.error === "rate_limited") throw rateLimited(value.retryAt);
    if (Array.isArray(value.users)) return value.users as SearchedUser[];
    if (typeof value.error === "string") throw new Error(`rngdle: ${value.error}`);
    throw new Error("rngdle user search didn't look right");
  }

  /** Your friends, with total EP and roll count. */
  async getFriends(): Promise<Friend[]> {
    this.requireCookie();
    const response = await fetch(`${ORIGIN}/api/friends?include_stats=true`, {
      headers: this.headers("*/*"),
      referrer: `${ORIGIN}/friends`,
    });
    const body = await readJson(response);
    if (!response.ok) throw httpError(response, body);
    if (!isRecord(body) || !Array.isArray(body.friends)) {
      throw new Error("rngdle friends response didn't look right");
    }
    return body.friends as Friend[];
  }

  /** Page through `/api/users/:username/rolls` until the api says it's done. */
  async getRolls(username: string): Promise<UserRolls> {
    if (!username) throw new Error("username is required");

    const rolls: Roll[] = [];
    let offset = 0;

    for (let pageNumber = 0; pageNumber < MAX_ROLL_PAGES; pageNumber += 1) {
      const page = await this.fetchRollPage(username, offset);
      rolls.push(...page.rolls);
      if (!page.hasMore) return summarizeRolls(rolls);
      if (page.rolls.length === 0) {
        throw new Error("rngdle said there were more rolls, then sent none");
      }
      offset += page.rolls.length;
    }

    throw new Error("stopped paging rolls, hasMore never cleared");
  }

  /** Received friend requests. Needs a session cookie. */
  async getFriendRequests(): Promise<FriendRequest[]> {
    this.requireCookie();
    const response = await fetch(`${ORIGIN}/api/friends/requests`, {
      headers: this.headers("*/*"),
      referrer: `${ORIGIN}/friends`,
    });
    const body = await readJson(response);
    if (!response.ok) throw httpError(response, body);
    if (!isRecord(body) || !Array.isArray(body.received)) {
      throw new Error("rngdle friend requests response didn't look right");
    }
    return body.received as FriendRequest[];
  }

  /**
   * Ask to be friends.
   * `userId` is their account id. The username is only there so the post hits their profile.
   */
  async sendFriendRequest(
    username: string,
  ): Promise<ActionResult> {
    if (!username) throw new Error("username is required");
    const userId = (await this.fetchUsers(username))[0].id;
    return this.postAction(
      `/u/${encodeURIComponent(username)}`,
      "sendFriendRequest",
      profileTree(username),
      userId,
    );
  }

  /** Accept a received request. Pass `FriendRequest.id`, not the user's id. */
  async acceptFriendRequest(requestId: string): Promise<ActionResult> {
    if (!requestId) throw new Error("requestId is required");
    return this.postAction(
      "/friends",
      "acceptFriendRequest",
      FRIENDS_TREE,
      requestId,
    );
  }

  /** Accept every received request, one after another. */
  async acceptAllFriendRequests(): Promise<ActionResult[]> {
    const requests = await this.getFriendRequests();
    const results: ActionResult[] = [];
    for (const request of requests) {
      results.push(await this.acceptFriendRequest(request.id));
    }
    return results;
  }

  private requireCookie(): void {
    if (this.sessionCookie) return;
    throw new Error("that needs your rngdle session cookie");
  }

  private headers(accept: string): Record<string, string> {
    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      Accept: accept,
      "Accept-Language": "en-US,en;q=0.9",
    };
    if (this.sessionCookie) headers.Cookie = this.sessionCookie;
    return headers;
  }

  private async fetchRollPage(
    username: string,
    offset: number,
  ): Promise<RollPage> {
    const url = `${ORIGIN}/api/users/${encodeURIComponent(username)}/rolls?limit=${ROLL_PAGE_SIZE}&offset=${offset}`;
    const response = await fetch(url, {
      headers: this.headers("*/*"),
      referrer: `${ORIGIN}/u/${encodeURIComponent(username)}`,
    });
    const body = await readJson(response);
    if (!response.ok) throw httpError(response, body);
    if (
      !isRecord(body) ||
      !Array.isArray(body.rolls) ||
      typeof body.hasMore !== "boolean"
    ) {
      throw new Error("rngdle rolls response didn't look right");
    }
    return { rolls: body.rolls as Roll[], hasMore: body.hasMore };
  }

  private async postAction(
    path: string,
    name: ActionName,
    stateTree: string,
    argument: string,
  ): Promise<ActionResult> {
    const value = await this.callAction(path, name, stateTree, argument);
    if (!isRecord(value) || typeof value.success !== "boolean") {
      throw new Error("rngdle action response had no result");
    }
    if (typeof value.error !== "string") return { success: value.success };
    return { success: value.success, error: value.error };
  }

  private async callAction(
    path: string,
    name: ActionName,
    stateTree: string,
    argument: string,
  ): Promise<unknown> {
    this.requireCookie();
    let response = await this.sendAction(
      path,
      await this.actionId(name),
      stateTree,
      argument,
    );
    if (response.status === 404) {
      this.actionIdsCache = null;
      response = await this.sendAction(
        path,
        await this.actionId(name),
        stateTree,
        argument,
      );
    }
    const text = await response.text();
    if (response.status === 404) throw new Error(`${name} is gone on rngdle`);
    if (!response.ok) {
      throw new Error(`rngdle action ${response.status}: ${text.slice(0, 200)}`);
    }
    return flightValue(text);
  }

  private async actionId(name: ActionName): Promise<string> {
    const ids = await this.actionIds();
    const id = ids.get(name);
    if (!id) throw new Error(`couldn't find ${name} on rngdle`);
    return id;
  }

  private actionIds(): Promise<Map<string, string>> {
    if (this.actionIdsCache) return this.actionIdsCache;
    this.actionIdsCache = loadActionIds().catch((error: unknown) => {
      this.actionIdsCache = null;
      throw error;
    });
    return this.actionIdsCache;
  }

  private sendAction(
    path: string,
    actionId: string,
    stateTree: string,
    argument: string,
  ): Promise<Response> {
    return fetch(`${ORIGIN}${path}`, {
      method: "POST",
      headers: {
        ...this.headers("text/x-component"),
        "Content-Type": "text/plain;charset=UTF-8",
        Origin: ORIGIN,
        "next-action": actionId,
        "next-router-state-tree": stateTree,
      },
      referrer: `${ORIGIN}${path}`,
      body: JSON.stringify([argument]),
    });
  }
}

function readTodayRoll(viewer: unknown): TodayRoll | null {
  if (!isRecord(viewer)) return null;
  if (viewer.hasRolledToday !== true) return null;
  if (!isRecord(viewer.lastRoll)) return null;
  if (typeof viewer.lastRoll.number !== "number") return null;
  if (typeof viewer.lastRoll.totalScore !== "number") return null;
  if (!Array.isArray(viewer.lastRoll.badges)) return null;
  if (viewer.lastRoll.poem !== null && typeof viewer.lastRoll.poem !== "string") return null;
  return viewer.lastRoll as TodayRoll;
}

function summarizeRolls(rolls: Roll[]): UserRolls {
  return {
    rolls,
    latestRoll: rolls[0] ?? null,
    bestRoll: pickBest(rolls),
  };
}

function pickBest(rolls: Roll[]): Roll | null {
  const first = rolls[0];
  if (!first) return null;
  return rolls.reduce(
    (best, roll) => (roll.totalScore > best.totalScore ? roll : best),
    first,
  );
}

function normalizeCookie(cookie: string): string {
  const trimmed = cookie.trim();
  if (!trimmed.toLowerCase().startsWith("cookie:")) return trimmed;
  return trimmed.slice("cookie:".length).trim();
}

function profileTree(username: string): string {
  return encodeURIComponent(
    JSON.stringify([
      "",
      {
        children: [
          "u",
          {
            children: [
              ["username", username, "d"],
              { children: ["__PAGE__", {}, null, null] },
              null,
              null,
            ],
          },
          null,
          null,
        ],
      },
      null,
      null,
      true,
    ]),
  );
}

async function loadActionIds(): Promise<Map<string, string>> {
  const page = await fetch(`${ORIGIN}/friends`, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
  });
  if (!page.ok) throw new Error(`rngdle friends page ${page.status}`);

  const html = await page.text();
  const scripts = [
    ...new Set(
      [...html.matchAll(/\/_next\/static\/chunks\/[a-z0-9]+\.js/g)].map(
        (match) => match[0],
      ),
    ),
  ];
  if (scripts.length === 0) throw new Error("rngdle friends page had no scripts");

  const files = await Promise.all(
    scripts.map(async (script) => {
      const response = await fetch(`${ORIGIN}${script}`, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (!response.ok) return "";
      return response.text();
    }),
  );

  const ids = new Map<string, string>();
  for (const file of files) {
    for (const match of file.matchAll(SERVER_ACTION)) {
      const id = match[1];
      const name = match[2];
      if (!id || !name) continue;
      if (!ACTION_NAMES.includes(name as ActionName)) continue;
      ids.set(name, id);
    }
  }

  for (const name of ACTION_NAMES) {
    if (!ids.has(name)) throw new Error(`couldn't find ${name} on rngdle`);
  }
  return ids;
}

function flightValue(body: string): unknown {
  const rows = new Map<string, unknown>();
  for (const line of body.split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const id = line.slice(0, separator);
    if (!/^\d+$/.test(id)) continue;
    rows.set(id, parseJson(line.slice(separator + 1)));
  }

  const header = rows.get("0");
  if (isRecord(header) && typeof header.a === "string" && header.a.startsWith("$@")) {
    return resolveFlight(rows.get(header.a.slice(2)), rows);
  }
  return resolveFlight(rows.get("1"), rows);
}

function resolveFlight(
  value: unknown,
  rows: Map<string, unknown>,
  seen = new Set<string>(),
): unknown {
  const referenceId = flightReferenceId(value);
  if (referenceId) {
    if (seen.has(referenceId)) return null;
    seen.add(referenceId);
    return resolveFlight(rows.get(referenceId), rows, seen);
  }
  if (Array.isArray(value)) return value.map((item) => resolveFlight(item, rows, seen));
  if (!isRecord(value)) return value;

  const resolved: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    resolved[key] = resolveFlight(item, rows, seen);
  }
  return resolved;
}

function flightReferenceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^\$@?(\d+)$/.exec(value);
  return match?.[1] ?? null;
}

function rateLimited(retryAt: unknown): Error {
  const retryAtMs = typeof retryAt === "number" ? retryAt : Date.now() + SEARCH_RETRY_FALLBACK_MS;
  const waitSeconds = Math.max(1, Math.ceil((retryAtMs - Date.now()) / 1000));
  return new Error(`rngdle user search is rate limited, try again in ${waitSeconds}s`);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`rngdle returned ${response.status} and it wasn't json`);
  }
}

function httpError(response: Response, body: unknown): Error {
  if (isRecord(body) && typeof body.error === "string") {
    return new Error(`rngdle ${response.status}: ${body.error}`);
  }
  return new Error(`rngdle ${response.status}`);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
