import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  binCanReceive,
  commentWithPrepStatus,
  lastPutawayBinReference,
  nextReceivingBinCode,
  prepStatusText,
  receiptFlagsForPrep,
  receivePrepKind,
  receivingAutoFillFocus,
  skuAlreadyInBinNote,
  receivingBinDecision,
  receivingBinDefault,
} from "@/lib/receivingLine";

describe("receive prep", () => {
  it("asks Cleaned for a CPU and Wiped for a drive", () => {
    assert.equal(receivePrepKind({ shortCode: "CPU" }), "cleaned");
    assert.equal(receivePrepKind({ longCode: "CPU/PRC", taxonomyName: "CPU" }), "cleaned");
    assert.equal(receivePrepKind({ taxonomyName: "processor" }), "cleaned");
    assert.equal(receivePrepKind({ shortCode: "HDD", longCode: "DSK/HDD" }), "wiped");
    assert.equal(receivePrepKind({ shortCode: "SSD" }), "wiped");
    assert.equal(receivePrepKind({ longCode: "DSK/SSD", taxonomyName: "SSD" }), "wiped");
    assert.equal(receivePrepKind({ shortCode: "MEM", longCode: "DIM/MEM", taxonomyName: "memory" }), null);
    assert.equal(receivePrepKind({ shortCode: "SRV" }), null);
  });

  it("stores the asked flag and leaves the other empty", () => {
    assert.deepEqual(receiptFlagsForPrep("cleaned", false, true), { cleaned: false, wiped: null });
    assert.deepEqual(receiptFlagsForPrep("wiped", true, false), { cleaned: null, wiped: false });
    assert.deepEqual(receiptFlagsForPrep("wiped", false, true), { cleaned: null, wiped: true });
    assert.deepEqual(receiptFlagsForPrep(null, true, true), { cleaned: null, wiped: null });
  });

  it("shows cleaned or dirty on a CPU and Wiped or Pending Wipe on a drive", () => {
    assert.equal(prepStatusText("cleaned", true, null), "cleaned");
    assert.equal(prepStatusText("cleaned", false, true), "dirty");
    assert.equal(prepStatusText("cleaned", null, false), null);
    assert.equal(prepStatusText("wiped", null, true), "Wiped");
    assert.equal(prepStatusText("wiped", true, false), "Pending Wipe");
    assert.equal(prepStatusText("wiped", false, null), null);
    assert.equal(prepStatusText(null, true, true), null);
    assert.equal(commentWithPrepStatus("pin bent", "cleaned", false, null), "dirty pin bent");
    assert.equal(commentWithPrepStatus("", "cleaned", true, null), "cleaned");
    assert.equal(commentWithPrepStatus("  date code  ", "wiped", null, true), "Wiped date code");
    assert.equal(commentWithPrepStatus("dirty already", "cleaned", null, null), "dirty already");
    assert.equal(commentWithPrepStatus("keep dirty word", null, null, null), "keep dirty word");
  });
});

describe("already in this bin", () => {
  it("glues the location and quantity after st", () => {
    assert.equal(
      skuAlreadyInBinNote("HWS.00.00.00.00", 96),
      "This SKU is already in this bin st HWS.00.00.00.00.96PCS",
    );
    assert.equal(
      skuAlreadyInBinNote("  HWR.01.04.06.n ", 4),
      "This SKU is already in this bin st HWR.01.04.06.n.4PCS",
    );
    assert.equal(skuAlreadyInBinNote(null, 4), null);
    assert.equal(skuAlreadyInBinNote("HWS.00.00.00", 0), null);
  });
});

describe("auto-filled search", () => {
  it("moves focus to quantity only when the search fills the line", () => {
    assert.equal(receivingAutoFillFocus("select"), "qty");
    assert.equal(receivingAutoFillFocus("list"), null);
    assert.equal(receivingAutoFillFocus("empty"), null);
    assert.equal(receivingAutoFillFocus("missing"), null);
  });
});

describe("typed receiving bin", () => {
  it("accepts a usable bin, offers to create an unknown one, and rejects a stuck cycle", () => {
    assert.deepEqual(receivingBinDecision("", null), { action: "empty" });
    assert.equal(receivingBinDecision("10099", null).action, "invalid");
    assert.deepEqual(receivingBinDecision("10099-C", null), {
      action: "create",
      reference: "10099-C",
      type: "C",
    });
    assert.deepEqual(receivingBinDecision("20014-b", { reference: "20014-B", canReceive: true }), {
      action: "accept",
      reference: "20014-B",
    });
    assert.equal(
      receivingBinDecision("20014-B", { reference: "20014-B", canReceive: false }).action,
      "unusable",
    );
  });

  it("treats an empty bin as usable and a stocked bin without an open cycle as not", () => {
    assert.equal(binCanReceive({ contents: [], cycles: [] }), true);
    assert.equal(binCanReceive({ contents: [{ qty: 0 }], cycles: [{ status: "closed" }] }), true);
    assert.equal(binCanReceive({ contents: [{ qty: 2 }], cycles: [{ status: "open" }] }), true);
    assert.equal(binCanReceive({ contents: [{ qty: 2 }], cycles: [{ status: "closed" }] }), false);
  });

  it("suggests the shared counter's next code", () => {
    assert.equal(nextReceivingBinCode(20042, "B"), "20042-B");
    assert.equal(nextReceivingBinCode(20042, "P"), "20042-P");
    assert.equal(nextReceivingBinCode(999, "B"), null);
  });
});

describe("receiving bin default", () => {
  it("reads the last putaway bin from a receipt row", () => {
    assert.equal(lastPutawayBinReference(null), null);
    assert.equal(lastPutawayBinReference({ bin_reference: "10059-c" }), "10059-C");
    assert.equal(lastPutawayBinReference({ bins: { reference: "20042-B" } }), "20042-B");
    assert.equal(lastPutawayBinReference({ bins: [{ reference: "20042-b" }] }), "20042-B");
    assert.equal(lastPutawayBinReference({ bin_reference: " ", bins: { reference: "20014-P" } }), "20014-P");
    assert.equal(lastPutawayBinReference({ bin_reference: "2000-B" }), null);
  });

  it("stays blank unless the SKU was put away before, and never invents the next number", () => {
    assert.equal(receivingBinDefault({ lastReference: null, userTyped: false, current: "" }), "");
    assert.equal(receivingBinDefault({ lastReference: "10059-c", userTyped: false, current: "" }), "10059-C");
    assert.equal(receivingBinDefault({ lastReference: "2000-B", userTyped: false, current: "" }), "");
    assert.equal(
      receivingBinDefault({ lastReference: "10059-C", userTyped: true, current: "20011-B" }),
      "20011-B",
    );
  });
});
