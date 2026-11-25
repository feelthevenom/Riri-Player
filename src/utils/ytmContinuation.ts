const ITEM_CONTINUATION_RENDERER_KEYS = new Set([
  'continuationItemRenderer',
]);

const ITEM_SHELF_OWNER_KEYS = new Set([
  'musicShelfRenderer',
  'musicPlaylistShelfRenderer',
  'gridRenderer',
  'musicCarouselShelfRenderer',
  'musicShelfContinuation',
  'musicPlaylistShelfContinuation',
  'gridContinuation',
]);

function readContinuation(container: unknown): string | undefined {
  if (!container || typeof container !== 'object') return undefined;
  const continuation = (container as Record<string, unknown>).continuation;
  return typeof continuation === 'string' && continuation ? continuation : undefined;
}

function readCommandToken(container: unknown): string | undefined {
  if (!container || typeof container !== 'object') return undefined;
  const obj = container as Record<string, unknown>;
  const command = obj.continuationCommand as Record<string, unknown> | undefined;
  if (typeof command?.token === 'string' && command.token) return command.token;

  const endpoint = obj.continuationEndpoint as Record<string, unknown> | undefined;
  const endpointCommand = endpoint?.continuationCommand as
    | Record<string, unknown>
    | undefined;
  if (typeof endpointCommand?.token === 'string' && endpointCommand.token) {
    return endpointCommand.token;
  }
  return undefined;
}

/**
 * Reads a continuation from one explicit continuation entry.
 *
 * `reloadContinuationData` is accepted only for an item shelf/grid because
 * InnerTube uses it for genuine next-page requests there. The same data type
 * is also reused by chip, sort/filter, and section-level reload commands,
 * which are deliberately excluded by the surrounding traversal.
 */
function readContinuationEntry(
  entry: unknown,
  options: { allowReload?: boolean } = {},
): string | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const obj = entry as Record<string, unknown>;

  return (
    readCommandToken(obj) ||
    readContinuation(obj.nextContinuationData) ||
    readContinuation(obj.continuationData) ||
    (options.allowReload
      ? readContinuation(obj.reloadContinuationData)
      : undefined)
  );
}

function isExcludedSubtree(key: string): boolean {
  return (
    key === 'frameworkUpdates' ||
    key === 'browseSectionListReloadEndpoint' ||
    key === 'chipCloudRenderer'
  );
}

/**
 * Extracts an InnerTube item-pagination continuation token.
 *
 * Only two response shapes are authoritative:
 * - an explicit `continuationItemRenderer` (used by search and shelf pages);
 * - a direct entry in a `continuations` array (used by browse shelves and
 *   section lists).
 *
 * YouTube Music also embeds reload tokens in chip navigation, sort/filter
 * menus, and framework updates. Those commands replace a shelf or control
 * rather than append the next page of items. Following one can produce the
 * same token again, so they are never treated as pagination.
 */
export interface YtMusicContinuationOptions {
  /**
   * Restrict extraction to continuations attached to an item shelf/grid.
   * Section-level next-page tokens can open auxiliary shelves (for example,
   * endless playlist suggestions) instead of more playlist members.
   */
  itemShelfOnly?: boolean;
}

export function extractYtMusicContinuation(
  json: unknown,
  options: YtMusicContinuationOptions = {},
): string | undefined {
  if (!json || typeof json !== 'object') return undefined;

  // Prefer an item continuation renderer. It is the least ambiguous signal
  // and is present even when a response also contains a global continuation
  // list for another section.
  const itemVisited = new WeakSet<object>();
  const findItemContinuation = (node: unknown, depth: number): string | undefined => {
    if (!node || typeof node !== 'object' || depth > 30) return undefined;
    if (itemVisited.has(node)) return undefined;
    itemVisited.add(node);

    if (Array.isArray(node)) {
      for (const element of node) {
        const found = findItemContinuation(element, depth + 1);
        if (found) return found;
      }
      return undefined;
    }

    const obj = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(obj)) {
      if (isExcludedSubtree(key)) continue;
      if (ITEM_CONTINUATION_RENDERER_KEYS.has(key)) {
        const token = readContinuationEntry(value);
        if (token) return token;
      }
      const found = findItemContinuation(value, depth + 1);
      if (found) return found;
    }
    return undefined;
  };

  const itemContinuation = findItemContinuation(json, 0);
  if (itemContinuation) return itemContinuation;

  // Browse responses commonly expose the next item page as a direct entry in
  // `continuations`: `{ nextContinuationData: ... }` or
  // `{ continuationData: ... }`. A `{ reloadContinuationData: ... }` entry is
  // accepted only when it belongs to an item shelf/grid; section-list reload
  // entries can be control reloads that reproduce the same token.
  const listVisited = new WeakSet<object>();
  const findListContinuation = (
    node: unknown,
    depth: number,
    ownerKey: string,
  ): string | undefined => {
    if (!node || typeof node !== 'object' || depth > 30) return undefined;
    if (listVisited.has(node)) return undefined;
    listVisited.add(node);

    if (Array.isArray(node)) {
      for (const element of node) {
        const found = findListContinuation(element, depth + 1, ownerKey);
        if (found) return found;
      }
      return undefined;
    }

    const obj = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(obj)) {
      if (isExcludedSubtree(key)) continue;
      if (key === 'continuations' && Array.isArray(value)) {
        const isItemShelf = ITEM_SHELF_OWNER_KEYS.has(ownerKey);
        if (!options.itemShelfOnly || isItemShelf) {
          const allowReload = isItemShelf;
          for (const entry of value) {
            const token = readContinuationEntry(entry, { allowReload });
            if (token) return token;
          }
        }
      }
      const found = findListContinuation(value, depth + 1, key);
      if (found) return found;
    }
    return undefined;
  };

  return findListContinuation(json, 0, '');
}
