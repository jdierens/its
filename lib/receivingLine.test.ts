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
  receivingSkuOverride,
  alreadyInBinNote,
  alreadyInBinNoteText,
  binBlurStartsLookup,
  binTypeMismatchMessage,
  receivingBinCreateMessage,
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

  it("shows cleaned or Dirty on a CPU and Wiped or Pending Wipe on a drive", () => {
    assert.equal(prepStatusText("cleaned", true, null), "cleaned");
    assert.equal(prepStatusText("cleaned", false, true), "Dirty");
    assert.equal(prepStatusText("cleaned", null, false), null);
    assert.equal(prepStatusText("wiped", null, true), "Wiped");
    assert.equal(prepStatusText("wiped", true, false), "Pending Wipe");
    assert.equal(prepStatusText("wiped", false, null), null);
    assert.equal(prepStatusText(null, true, true), null);
    assert.equal(commentWithPrepStatus("pin bent", "cleaned", false, null), "Dirty pin bent");
    assert.equal(commentWithPrepStatus("", "cleaned", true, null), "cleaned");
    assert.equal(commentWithPrepStatus("  date code  ", "wiped", null, true), "Wiped date code");
    assert.equal(commentWithPrepStatus("dirty already", "cleaned", null, null), "dirty already");
    assert.equal(commentWithPrepStatus("keep dirty word", null, null, null), "keep dirty word");
  });
});

describe("already in this bin", () => {
  it("sums every receipt in the current bin into one total", () => {
    const note = alreadyInBinNote({
      currentBin: "10069-c",
      rows: [
        { reference: "10069-C", qty: 32, locationCode: " HWS.00.00.00 " },
        { reference: "10069-C", qty: 16, locationCode: "HWS.00.00.00" },
        { reference: "10069-C", qty: 0, locationCode: "HWS.00.00.00" },
      ],
    });
    assert.ok(note);
    assert.equal(note.others.length, 0);
    assert.equal(
      alreadyInBinNoteText(note),
      "48 PCS of this SKU are already in this bin at HWS.00.00.00.",
    );
  });

  it("continues with other bins and does not repeat the current one", () => {
    const note = alreadyInBinNote({
      currentBin: "10009-C",
      rows: [
        { reference: "10009-C", qty: 10, locationCode: "HWS.00.00.00" },
        { reference: "10009-C", qty: 6, locationCode: null },
        { reference: "10010-C", qty: 4, locationCode: "HWS.00.00.00" },
        { reference: "10010-C", qty: 6, locationCode: "HWS.00.00.00" },
        { reference: "10069-C", qty: 3, locationCode: "HWR.01.04.06.n" },
      ],
    });
    assert.ok(note);
    assert.equal(
      alreadyInBinNoteText(note),
      "16 PCS of this SKU are already in this bin at HWS.00.00.00. More in other bins: 10010-C (x10), 10069-C (x3).",
    );
  });

  it("names other bins when the current bin has none, and hides the note when every total is 0", () => {
    const elsewhere = alreadyInBinNote({
      currentBin: "20002-B",
      rows: [
        { reference: "10010-C", qty: 10, locationCode: "HWS.00.00.00" },
        { reference: "10069-C", qty: 3, locationCode: "HWS.00.00.00" },
        { reference: "20002-B", qty: 0, locationCode: "HWS.00.00.00" },
      ],
    });
    assert.ok(elsewhere);
    assert.equal(elsewhere.current, null);
    assert.equal(
      alreadyInBinNoteText(elsewhere),
      "This SKU is in other bins: 10010-C (x10), 10069-C (x3).",
    );
    assert.equal(
      alreadyInBinNote({
        currentBin: "",
        rows: [
          { reference: "10069-C", qty: 0, locationCode: "HWS.00.00.00" },
          { reference: "not-a-bin", qty: 8, locationCode: "HWS.00.00.00" },
        ],
      }),
      null,
    );
    assert.equal(alreadyInBinNote({ currentBin: "10069-C", rows: [] }), null);
  });

  it("still states the current total when that bin has no location", () => {
    const note = alreadyInBinNote({
      currentBin: "10069-C",
      rows: [{ reference: "10069-C", qty: 4, locationCode: "  " }],
    });
    assert.ok(note);
    assert.equal(alreadyInBinNoteText(note), "4 PCS of this SKU are already in this bin.");
  });
});

describe("auto-filled search", () => {
  it("moves focus to quantity when the search fills the line, and not when it only opens a list", () => {
    assert.equal(receivingAutoFillFocus("select"), "qty");
    assert.equal(receivingAutoFillFocus("list"), null);
    assert.equal(receivingAutoFillFocus("empty"), null);
    assert.equal(receivingAutoFillFocus("missing"), null);
  });
});

describe("sku override", () => {
  it("replaces the item only when the typed SKU is an exact match", () => {
    assert.equal(receivingSkuOverride({ typedSku: "106880", currentSku: "50077", exactSku: "106880" }), "apply");
    assert.equal(receivingSkuOverride({ typedSku: " 106880 ", currentSku: "50077", exactSku: "106880" }), "apply");
    assert.equal(receivingSkuOverride({ typedSku: "abc", currentSku: "50077", exactSku: "ABC" }), "apply");
    assert.equal(receivingSkuOverride({ typedSku: "106880", currentSku: "50077", exactSku: null }), "pending");
    assert.equal(receivingSkuOverride({ typedSku: "10688", currentSku: "50077", exactSku: null }), "pending");
    assert.equal(receivingSkuOverride({ typedSku: "106880", currentSku: "50077", exactSku: "99999" }), "pending");
    assert.equal(receivingSkuOverride({ typedSku: "50077", currentSku: "50077", exactSku: null }), "same");
    assert.equal(receivingSkuOverride({ typedSku: "50077", currentSku: "50077", exactSku: "50077" }), "same");
    assert.equal(receivingSkuOverride({ typedSku: "", currentSku: "50077", exactSku: null }), "same");
  });
});

describe("bin blur before save", () => {
  it("lets the Save click post the receipt instead of spending it on a lookup", () => {
    const save = { closest: (selector: string) => (selector === "#receive-save" ? save : null) };
    assert.equal(binBlurStartsLookup(save), false);
    assert.equal(binBlurStartsLookup({ closest: () => null }), true);
    assert.equal(binBlurStartsLookup(null), true);
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

  it("asks to adjust the suffix when that number is already another type", () => {
    const message = "BIN 10042 is a Crate and you selected a Box, please adjust your bin selection";
    assert.equal(binTypeMismatchMessage(10042, "C", "B"), message);
    assert.equal(binTypeMismatchMessage(10042, "P", "C"), "BIN 10042 is a Pallet and you selected a Crate, please adjust your bin selection");
    const decision = receivingBinDecision("10042-B", null, { reference: "10042-C", type: "C" });
    assert.equal(decision.action, "mismatch");
    if (decision.action !== "mismatch") return;
    assert.equal(decision.message, message);
    assert.equal(decision.existingReference, "10042-C");
    assert.equal(decision.selectedReference, "10042-B");
    assert.equal(decision.selected, "B");
    assert.notEqual(receivingBinDecision("10099-C", null, null).action, "mismatch");
    assert.equal(receivingBinDecision("10099-C", null).action, "create");
    assert.equal(
      receivingBinDecision("10042-C", null, { reference: "10042-c", type: "C" }).action,
      "invalid",
    );
  });

  it("returns the crate mismatch instead of the production digest when create is refused", () => {
    const database = {
      message: "10042-C already exists. Scan it instead of creating a new one.",
      code: "23505",
    };
    assert.equal(
      receivingBinCreateMessage(database, "10042-B"),
      "BIN 10042 is a Crate and you selected a Box, please adjust your bin selection",
    );
    assert.equal(
      receivingBinCreateMessage(database, "10042-C"),
      "10042-C already exists. Scan it instead of creating a new one.",
    );
    assert.equal(
      receivingBinCreateMessage(
        new Error("An error occurred in the Server Components render. The specific message is omitted in production builds."),
        "10042-B",
      ),
      "The bin was not created.",
    );
    assert.match(receivingBinCreateMessage({ message: 'duplicate key value violates unique constraint "bins_number_unique"' }, "10042-B"), /10042/);
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
