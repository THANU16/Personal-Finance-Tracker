import { Schema, Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { intField, userScopedModel } from "@/server/db/model";
import { withTransaction } from "@/server/db/transaction";
import { UnscopedQueryError } from "@/server/db/user-id-guard";
import { setupTestDb } from "../helpers/test-db";

setupTestDb();

const probeSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true, index: true },
  amountMinor: intField({ required: true }),
});
const Probe = userScopedModel("TestProbe", probeSchema, "testProbes");

const uid = () => new Types.ObjectId();

describe("userId guard", () => {
  it.each([
    ["find", () => Probe.find({})],
    ["findOne", () => Probe.findOne({ amountMinor: 1 })],
    ["countDocuments", () => Probe.countDocuments()],
    ["updateMany", () => Probe.updateMany({}, { $set: { amountMinor: 0 } })],
    ["deleteOne", () => Probe.deleteOne({ _id: uid() })],
    ["findOneAndUpdate", () => Probe.findOneAndUpdate({ _id: uid() }, { amountMinor: 2 })],
    ["aggregate", () => Probe.aggregate([{ $group: { _id: null, n: { $sum: 1 } } }])],
  ])("rejects unscoped %s", async (_op, run) => {
    await expect(run()).rejects.toBeInstanceOf(UnscopedQueryError);
  });

  it("allows scoped queries, including userId inside $and", async () => {
    const userId = uid();
    await Probe.create({ userId, amountMinor: 100 });
    expect(await Probe.countDocuments({ userId })).toBe(1);
    expect(await Probe.find({ $and: [{ userId }, { amountMinor: 100 }] })).toHaveLength(1);
    const agg = await Probe.aggregate([{ $match: { userId } }, { $count: "n" }]);
    expect(agg).toEqual([{ n: 1 }]);
  });

  it("can be skipped explicitly for cross-user jobs", async () => {
    await Probe.create({ userId: uid(), amountMinor: 1 });
    await Probe.create({ userId: uid(), amountMinor: 2 });
    expect(await Probe.countDocuments({}).setOptions({ skipUserIdGuard: true })).toBe(2);
  });

  it("rejects non-integer money on save", async () => {
    await expect(Probe.create({ userId: uid(), amountMinor: 1.5 })).rejects.toThrow(/integer/);
  });
});

describe("withTransaction", () => {
  it("commits every write and returns the callback result", async () => {
    const userId = uid();
    const result = await withTransaction(async (session) => {
      await Probe.create([{ userId, amountMinor: 1 }], { session });
      await Probe.create([{ userId, amountMinor: 2 }], { session });
      return "done";
    });
    expect(result).toBe("done");
    expect(await Probe.countDocuments({ userId })).toBe(2);
  });

  it("rolls back every write when it fails part-way", async () => {
    const userId = uid();
    await expect(
      withTransaction(async (session) => {
        await Probe.create([{ userId, amountMinor: 1 }], { session });
        await Probe.updateOne({ userId }, { $set: { amountMinor: 5 } }, { session });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await Probe.countDocuments({ userId })).toBe(0);
  });
});
