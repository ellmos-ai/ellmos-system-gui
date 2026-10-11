// Lazy skill full-text reader for the catalog views (#2018). Pure logic with injectable fetch/clipboard so it is testable
// without a DOM. The library id comes from the catalog PATH (resolveLibraryIds), never from the display name; without an
// unambiguous match in the real skill library the reader is disabled with the reason.
import {requestJson, loadSkill} from './capability-board-client.mjs';
import {resolveLibraryIds} from './catalog-views.mjs';

export const MAX_SOURCE_BYTES = 200000; // same limit as skill_source_service.MAX_SOURCE_BYTES
const LIBRARY_URL = '/api/capabilities/skills/library';
const byteLength = text => new TextEncoder().encode(text).length;

export function createSkillReader({fetcher = globalThis.fetch, clipboard = globalThis.navigator?.clipboard} = {}) {
  let rows = [];
  let resolution = null;
  let libraryPromise = null;
  const sources = new Map();   // library id -> Promise of a verified source (only successes stay cached)

  const library = () => {
    if (!libraryPromise) {
      libraryPromise = requestJson(LIBRARY_URL, {}, fetcher).then(data => {
        if (!data || !Array.isArray(data.skills)) throw new Error('Die Skill-Bibliothek liefert keine lesbare Liste.');
        return new Set(data.skills.map(skill => skill && skill.id).filter(id => typeof id === 'string'));
      }).catch(error => { libraryPromise = null; throw error; });
    }
    return libraryPromise;
  };

  async function resolve(row) {
    if (!resolution) resolution = resolveLibraryIds(rows, await library());
    return resolution.get(row.key) || {id: null, reason: 'Skill nicht im Katalog.'};
  }

  return {
    setRows(next) { rows = next; resolution = null; },
    // Resolve + read. Result is always one of: disabled (with reason), loaded (verified source), error (message).
    async open(row) {
      let match;
      try { match = await resolve(row); }
      catch (error) { resolution = null; return {state: 'error', message: error.message}; }
      if (!match.id) return {state: 'disabled', reason: match.reason};
      if (!sources.has(match.id)) {
        sources.set(match.id, loadSkill(match.id, fetcher).then(source => {
          if (byteLength(source.content) > MAX_SOURCE_BYTES) throw new Error('Der Volltext überschreitet ' + MAX_SOURCE_BYTES + ' Byte und wird nicht angezeigt.');
          return source;
        }).catch(error => { sources.delete(match.id); throw error; }));
      }
      try { return {state: 'loaded', id: match.id, source: await sources.get(match.id)}; }
      catch (error) { return {state: 'error', id: match.id, message: error.message}; }
    },
    async libraryId(row) { try { return (await resolve(row)).id; } catch { return null; } },
    async copy(value, label) {
      if (!clipboard || typeof clipboard.writeText !== 'function') return {ok: false, message: 'Kopieren nicht möglich (keine Zwischenablage).'};
      try { await clipboard.writeText(value); return {ok: true, message: label + ' kopiert.'}; }
      catch { return {ok: false, message: 'Kopieren nicht möglich (Zwischenablage gesperrt).'}; }
    },
    async copyFullText(row) {
      const result = await this.open(row);
      if (result.state !== 'loaded') return {ok: false, message: result.reason || result.message};
      return this.copy(result.source.content, 'Volltext');
    },
    async copyLibraryId(row) {
      const id = await this.libraryId(row);
      return id ? this.copy(id, 'Bibliotheks-ID') : {ok: false, message: 'Keine eindeutige Bibliotheks-ID.'};
    },
    copyCatalogId(row) { return this.copy(row.id, 'Katalog-ID'); },
  };
}
