// Keeps this device's recipes in step with the copy on the Worker (see worker/worker.js).
// Each recipe is compared by its last change time and the newest copy wins.
// Deleting a recipe leaves a tombstone on the Worker, so other devices delete it too.

const stamp = (r) => r.updatedAt || r.createdAt || 0;

/**
 * Works out what to do, from this device's recipes, the Worker's list ({ id, u, d })
 * and the ids deleted here that the Worker doesn't know about yet.
 */
export function planSync(local, remote, deleted = []) {
  const mine = new Map(local.map((r) => [r.id, r]));
  const theirs = new Map(remote.map((e) => [e.id, e]));
  const gone = new Set(deleted);
  const plan = { push: [], pull: [], drop: [], remove: [] };

  for (const e of remote) {
    if (gone.has(e.id)) continue;
    const r = mine.get(e.id);
    if (e.d) {
      if (r && stamp(r) <= e.u) plan.drop.push(e.id);
    } else if (!r || stamp(r) < e.u) plan.pull.push(e.id);
  }
  for (const r of local) {
    const e = theirs.get(r.id);
    if (!e || stamp(r) > e.u) plan.push.push(r.id);
  }
  for (const id of gone) if (theirs.get(id) && !theirs.get(id).d && !mine.has(id)) plan.remove.push(id);
  return plan;
}

/** Talks to the Worker's /sync endpoints. */
export function syncApi(workerUrl, token) {
  async function call(path, init = {}) {
    const res = await fetch(`${workerUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Sync error ${res.status}`), { status: res.status });
    return data;
  }
  const at = (id) => `/sync/${encodeURIComponent(id)}`;
  return {
    list: () => call("/sync"),
    get: (id) => call(at(id)),
    put: (r) => call(at(r.id), { method: "PUT", body: JSON.stringify(r) }),
    remove: (id) => call(at(id), { method: "DELETE" }),
  };
}
