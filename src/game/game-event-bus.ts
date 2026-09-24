import { EventEmitter } from "node:events";
import type {
  GameEventTransport,
  IncomingGameEvent,
  MatchSnapshot,
  StoredGameEvent,
} from "../types.js";

const DEFAULT_CAPACITY = 200;
const SEEN_ID_CAPACITY = 500;

function emptyMatchSnapshot(): MatchSnapshot {
  return {
    phase: "",
    shopOpen: null,
    dead: false,
    respawnSec: null,
    clock: "",
    friendlyKills: null,
    enemyKills: null,
    lastKill: "",
    hero: "",
    httpOk: null,
    panelsFound: {
      dataFeed: null,
      announcements: null,
      gameEvents: null,
    },
    updatedAt: 0,
  };
}

export class GameEventBus extends EventEmitter<{
  event: [StoredGameEvent];
  cleared: [];
}> {
  private readonly events: StoredGameEvent[] = [];
  private readonly seenIds = new Set<string>();
  private readonly seenOrder: string[] = [];
  private seq = 0;
  private modLastSeenAt = 0;
  private lastTransport: GameEventTransport | null = null;
  private lastEventType = "";
  private lastHeartbeat: Record<string, unknown> | null = null;
  private match: MatchSnapshot = emptyMatchSnapshot();

  constructor(private readonly capacity = DEFAULT_CAPACITY) {
    super();
  }

  ingest(
    raw: IncomingGameEvent,
    transport: GameEventTransport,
  ): StoredGameEvent | null {
    if (!raw || typeof raw !== "object") return null;

    const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `auto-${++this.seq}`;
    if (this.seenIds.has(id)) return null;

    this.rememberId(id);

    const type = typeof raw.type === "string" && raw.type ? raw.type : "raw";
    const payload =
      raw.payload && typeof raw.payload === "object" ? raw.payload : {};
    const receivedAt = Date.now();

    this.modLastSeenAt = receivedAt;
    this.lastTransport = transport;
    this.lastEventType = type;

    if (type === "heartbeat") {
      this.lastHeartbeat = payload;
      this.applyHeartbeatToMatch(payload);
      return null;
    }

    const stored: StoredGameEvent = {
      v: typeof raw.v === "number" ? raw.v : 1,
      id,
      tsMs: typeof raw.tsMs === "number" && Number.isFinite(raw.tsMs) ? raw.tsMs : receivedAt,
      type,
      payload,
      seq: ++this.seq,
      receivedAt,
      transport,
    };

    this.events.unshift(stored);
    if (this.events.length > this.capacity) {
      this.events.length = this.capacity;
    }

    this.applyEventToMatch(stored);
    this.emit("event", stored);
    return stored;
  }

  getEvents(afterSeq?: number, limit = 100): StoredGameEvent[] {
    const capped = Math.min(Math.max(limit, 1), this.capacity);
    let list = this.events;
    if (typeof afterSeq === "number" && Number.isFinite(afterSeq)) {
      list = list.filter((e) => e.seq > afterSeq);
      // Oldest-first among new events so clients can advance the cursor safely
      return [...list].sort((a, b) => a.seq - b.seq).slice(0, capped);
    }
    return list.slice(0, capped);
  }

  clear(): void {
    this.events.length = 0;
    this.seenIds.clear();
    this.seenOrder.length = 0;
    this.lastHeartbeat = null;
    this.match = emptyMatchSnapshot();
    this.lastEventType = "";
    this.emit("cleared");
  }

  getModStatus(): {
    modLastSeenAt: number;
    lastTransport: GameEventTransport | null;
    lastEventType: string;
    eventCount: number;
    lastHeartbeat: Record<string, unknown> | null;
    match: MatchSnapshot;
  } {
    return {
      modLastSeenAt: this.modLastSeenAt,
      lastTransport: this.lastTransport,
      lastEventType: this.lastEventType,
      eventCount: this.events.length,
      lastHeartbeat: this.lastHeartbeat,
      match: { ...this.match, panelsFound: { ...this.match.panelsFound } },
    };
  }

  private rememberId(id: string): void {
    this.seenIds.add(id);
    this.seenOrder.push(id);
    while (this.seenOrder.length > SEEN_ID_CAPACITY) {
      const old = this.seenOrder.shift();
      if (old) this.seenIds.delete(old);
    }
  }

  private touchMatch(): void {
    this.match.updatedAt = Date.now();
  }

  private applyHeartbeatToMatch(payload: Record<string, unknown>): void {
    if (typeof payload.phase === "string" && payload.phase) {
      this.match.phase = payload.phase;
      // phase===shop can open; never clear shopOpen from phase alone —
      // top_bar often misses CitadelHudHeroShop and would wipe shop_open events.
      if (payload.phase === "shop") this.match.shopOpen = true;
    }
    if (typeof payload.shopOpen === "boolean") {
      this.match.shopOpen = payload.shopOpen;
    }
    // Never wipe a known clock with empty heartbeat payload.
    if (typeof payload.clock === "string" && payload.clock.trim()) {
      this.match.clock = payload.clock.trim();
    }
    if (typeof payload.friendlyKills === "number" && Number.isFinite(payload.friendlyKills)) {
      this.match.friendlyKills = payload.friendlyKills;
    }
    if (typeof payload.enemyKills === "number" && Number.isFinite(payload.enemyKills)) {
      this.match.enemyKills = payload.enemyKills;
    }
    if (typeof payload.dead === "boolean") {
      this.match.dead = payload.dead;
    }
    if (typeof payload.hero === "string" && payload.hero) {
      this.match.hero = payload.hero;
    }
    if (typeof payload.httpOk === "boolean") {
      this.match.httpOk = payload.httpOk;
    } else if (payload.httpOk === null) {
      this.match.httpOk = null;
    }
    const panels = payload.panelsFound;
    if (panels && typeof panels === "object") {
      const p = panels as Record<string, unknown>;
      if (typeof p.dataFeed === "boolean") this.match.panelsFound.dataFeed = p.dataFeed;
      if (typeof p.announcements === "boolean") {
        this.match.panelsFound.announcements = p.announcements;
      }
      if (typeof p.gameEvents === "boolean") {
        this.match.panelsFound.gameEvents = p.gameEvents;
      }
    }
    this.touchMatch();
  }

  private applyEventToMatch(evt: StoredGameEvent): void {
    const p = evt.payload;
    switch (evt.type) {
      case "phase":
        if (typeof p.phase === "string") {
          this.match.phase = p.phase;
          // Only open from phase; closing requires shop_closed / explicit shopOpen=false.
          if (p.phase === "shop") this.match.shopOpen = true;
        }
        break;
      case "shop_open":
        this.match.shopOpen = true;
        if (!this.match.phase || this.match.phase === "in_match" || this.match.phase === "unknown") {
          this.match.phase = "shop";
        }
        break;
      case "shop_closed":
        this.match.shopOpen = false;
        if (this.match.phase === "shop") this.match.phase = "in_match";
        break;
      case "local_death":
        this.match.dead = true;
        this.match.respawnSec =
          typeof p.respawnSec === "number" && Number.isFinite(p.respawnSec)
            ? p.respawnSec
            : null;
        break;
      case "local_respawn":
        this.match.dead = false;
        this.match.respawnSec = null;
        break;
      case "score":
        if (typeof p.clock === "string" && p.clock.trim()) {
          this.match.clock = p.clock.trim();
        }
        if (typeof p.friendlyKills === "number") this.match.friendlyKills = p.friendlyKills;
        if (typeof p.enemyKills === "number") this.match.enemyKills = p.enemyKills;
        break;
      case "hero":
        if (typeof p.name === "string" && p.name) this.match.hero = p.name;
        break;
      case "killfeed": {
        const text =
          typeof p.text === "string"
            ? p.text
            : [p.killer, p.victim].filter((x) => typeof x === "string").join(" → ");
        if (text) this.match.lastKill = text.slice(0, 120);
        break;
      }
      case "api_probe": {
        const globals = p.globals;
        if (globals && typeof globals === "object") {
          const g = globals as Record<string, unknown>;
          if (typeof g.GameEvents === "boolean") {
            this.match.panelsFound.gameEvents = g.GameEvents;
          }
        }
        if (typeof p.gameEventsSubscribe === "boolean") {
          this.match.panelsFound.gameEvents = p.gameEventsSubscribe;
        }
        break;
      }
      case "mod_loaded":
        break;
      default:
        break;
    }

    if (typeof p.httpOk === "boolean") {
      this.match.httpOk = p.httpOk;
    }
    if (typeof p.hero === "string" && p.hero) {
      this.match.hero = p.hero;
    }

    // Panel presence hints from poll payloads
    if (typeof p.dataFeedFound === "boolean") {
      this.match.panelsFound.dataFeed = p.dataFeedFound;
    }
    if (typeof p.announcementsFound === "boolean") {
      this.match.panelsFound.announcements = p.announcementsFound;
    }

    this.touchMatch();
  }
}

export function parseIncomingGameEvent(body: unknown): IncomingGameEvent | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  if (typeof obj.type !== "string" && typeof obj.id !== "string") return null;
  return {
    v: typeof obj.v === "number" ? obj.v : 1,
    id: typeof obj.id === "string" ? obj.id : "",
    tsMs: typeof obj.tsMs === "number" ? obj.tsMs : Date.now(),
    type: typeof obj.type === "string" ? obj.type : "raw",
    payload:
      obj.payload && typeof obj.payload === "object"
        ? (obj.payload as Record<string, unknown>)
        : {},
  };
}
