// Voice notes not yet in the room, kept on this phone until the room says it has them.
// A failed send, a closed app or a reload never loses the recording: it waits here with "Tap to send again".
export type Outgoing = { cid: string; blob: Blob; type: string; seconds: number; thread?: string; at: number };

function db(): Promise<IDBDatabase> {
  return new Promise((ok, no) => {
    const r = indexedDB.open("shellphone", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("outbox", { keyPath: "cid" });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
}
async function store<T>(mode: IDBTransactionMode, act: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  try {
    const d = await db();
    return await new Promise<T>((ok, no) => { const r = act(d.transaction("outbox", mode).objectStore("outbox")); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  } catch { return undefined; }  // private mode or no storage: sending still works, only the keeping doesn't
}
export const keep = (o: Outgoing) => store("readwrite", (s) => s.put(o));
export const drop = (cid: string) => store("readwrite", (s) => s.delete(cid));
export const waiting = async () => ((await store("readonly", (s) => s.getAll())) || []) as Outgoing[];
