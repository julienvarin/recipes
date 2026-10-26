import { test } from "node:test";
import assert from "node:assert/strict";
import { planSync } from "../js/sync.js";

test("pushes what the Worker lacks and pulls what this device lacks", () => {
  const local = [{ id: "a", createdAt: 1 }, { id: "b", createdAt: 1, updatedAt: 9 }];
  const remote = [{ id: "b", u: 5, d: 0 }, { id: "c", u: 3, d: 0 }];
  assert.deepEqual(planSync(local, remote), { push: ["a", "b"], pull: ["c"], drop: [], remove: [] });
});

test("the newest copy wins and equal copies are left alone", () => {
  const local = [{ id: "a", updatedAt: 5 }, { id: "b", updatedAt: 7 }];
  const remote = [{ id: "a", u: 8, d: 0 }, { id: "b", u: 7, d: 0 }];
  assert.deepEqual(planSync(local, remote), { push: [], pull: ["a"], drop: [], remove: [] });
});

test("deletions travel both ways", () => {
  const local = [{ id: "a", updatedAt: 5 }, { id: "b", updatedAt: 9 }];
  const remote = [{ id: "a", u: 6, d: 1 }, { id: "b", u: 6, d: 1 }, { id: "c", u: 4, d: 0 }];
  // a was deleted elsewhere; b was edited here after that delete, so it comes back; c was deleted here.
  assert.deepEqual(planSync(local, remote, ["c"]), { push: ["b"], pull: [], drop: ["a"], remove: ["c"] });
});
