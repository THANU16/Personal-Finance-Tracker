import { describe, expect, it } from "vitest";
import { checkEnvelope, remapIds } from "@/domain/backup";

class Id {
  constructor(readonly v: string) {}
}
let n = 0;
const ops = {
  isId: (v: unknown): v is Id => v instanceof Id,
  keyOf: (id: Id) => id.v,
  fresh: () => new Id(`new${++n}`),
};

describe("remapIds", () => {
  it("fresh ids everywhere; references follow; userId becomes the target; unknown refs kept", () => {
    n = 0;
    const acc = new Id("a1");
    const cat = new Id("c1");
    const date = new Date("2026-01-01T00:00:00Z");
    const out = remapIds(
      {
        accounts: [{ _id: acc, userId: new Id("old-user"), name: "Bank" }],
        categories: [{ _id: cat, userId: new Id("old-user") }],
        transactions: [
          {
            _id: new Id("t1"),
            userId: new Id("old-user"),
            fromAccountId: acc,
            splits: [{ categoryId: cat }],
            source: { refId: new Id("missing") },
            date,
          },
        ],
      },
      new Id("me"),
      ops,
    );
    const t = out.transactions![0]!;
    expect((out.accounts![0]!._id as Id).v).toBe("new1");
    expect((t.fromAccountId as Id).v).toBe("new1");
    expect((t.splits as { categoryId: Id }[])[0]!.categoryId.v).toBe("new2");
    expect((t.userId as Id).v).toBe("me");
    expect((t.source as { refId: Id }).refId.v).toBe("missing");
    expect(t.date).toBe(date);
    expect(acc.v).toBe("a1");
  });
});

describe("checkEnvelope", () => {
  const ok = {
    format: "wealthtrack-backup",
    version: 1,
    exportedAt: "x",
    baseCurrency: "LKR",
    collections: { accounts: [] },
  };
  it("accepts a valid envelope and rejects others", () => {
    expect(checkEnvelope(ok, ["accounts"]).ok).toBe(true);
    expect(checkEnvelope({ ...ok, format: "x" }, ["accounts"])).toMatchObject({ ok: false });
    expect(checkEnvelope({ ...ok, version: 99 }, ["accounts"])).toMatchObject({
      ok: false,
      message: expect.stringContaining("newer"),
    });
    expect(checkEnvelope({ ...ok, collections: { hacks: [] } }, ["accounts"])).toMatchObject({
      ok: false,
    });
    expect(checkEnvelope(null, [])).toMatchObject({ ok: false });
  });
});
