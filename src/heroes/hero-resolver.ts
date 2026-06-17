import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "../config.js";

export interface ResolvedHero {
  id: number;
  name: string;
}

export interface HeroResolver {
  resolveHeroInput(input: string): ResolvedHero | null;
  resolveHeroInputs(input: string): { heroes: ResolvedHero[]; errors: string[] };
  getHeroName(id: number): string | undefined;
}

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, "")
    .replace(/\s+/g, " ");
}

function normalizeCompact(value: string): string {
  return normalizeKey(value).replace(/\s+/g, "");
}

function parseHeroesTsv(raw: string): Map<number, string> {
  const heroes = new Map<number, string>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const tab = trimmed.indexOf("\t");
    if (tab === -1) continue;
    const id = Number.parseInt(trimmed.slice(0, tab).trim(), 10);
    const name = trimmed.slice(tab + 1).trim();
    if (Number.isFinite(id) && name) {
      heroes.set(id, name);
    }
  }
  return heroes;
}

function parseAliases(raw: Record<string, unknown>): Map<string, number> {
  const aliases = new Map<string, number>();
  const entries = raw.aliases;
  if (!entries || typeof entries !== "object") return aliases;

  for (const [alias, id] of Object.entries(entries as Record<string, unknown>)) {
    const numericId = typeof id === "number" ? id : Number.parseInt(String(id), 10);
    if (!Number.isFinite(numericId)) continue;
    aliases.set(normalizeKey(alias), numericId);
    aliases.set(normalizeCompact(alias), numericId);
  }
  return aliases;
}

export function createHeroResolver(): HeroResolver {
  const heroesPath = join(projectRoot, "config", "heroes.tsv");
  const aliasesPath = join(projectRoot, "config", "hero_aliases.json");

  const heroes = existsSync(heroesPath)
    ? parseHeroesTsv(readFileSync(heroesPath, "utf8"))
    : new Map<number, string>();

  const aliases = existsSync(aliasesPath)
    ? parseAliases(JSON.parse(readFileSync(aliasesPath, "utf8")) as Record<string, unknown>)
    : new Map<string, number>();

  const nameToId = new Map<string, number>();
  for (const [id, name] of heroes) {
    nameToId.set(normalizeKey(name), id);
    nameToId.set(normalizeCompact(name), id);
  }

  function resolveSingle(token: string): ResolvedHero | null {
    const trimmed = token.trim();
    if (!trimmed) return null;

    if (/^\d+$/.test(trimmed)) {
      const id = Number.parseInt(trimmed, 10);
      if (heroes.has(id)) {
        return { id, name: heroes.get(id)! };
      }
      return null;
    }

    const normalized = normalizeKey(trimmed);
    const compact = normalizeCompact(trimmed);

    const fromAlias = aliases.get(normalized) ?? aliases.get(compact);
    if (fromAlias !== undefined && heroes.has(fromAlias)) {
      return { id: fromAlias, name: heroes.get(fromAlias)! };
    }

    const fromName = nameToId.get(normalized) ?? nameToId.get(compact);
    if (fromName !== undefined) {
      return { id: fromName, name: heroes.get(fromName)! };
    }

    return null;
  }

  return {
    getHeroName(id: number): string | undefined {
      return heroes.get(id);
    },

    resolveHeroInput(input: string): ResolvedHero | null {
      const result = this.resolveHeroInputs(input);
      return result.heroes[0] ?? null;
    },

    resolveHeroInputs(input: string): { heroes: ResolvedHero[]; errors: string[] } {
      const heroesOut: ResolvedHero[] = [];
      const errors: string[] = [];
      const seen = new Set<number>();

      for (const token of input.split(/[,;]+/)) {
        const trimmed = token.trim();
        if (!trimmed) continue;

        const resolved = resolveSingle(trimmed);
        if (!resolved) {
          errors.push(`Неизвестный герой: "${trimmed}"`);
          continue;
        }
        if (seen.has(resolved.id)) continue;
        seen.add(resolved.id);
        heroesOut.push(resolved);
      }

      return { heroes: heroesOut, errors };
    },
  };
}
