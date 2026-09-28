import { describe, expect, it } from "vitest";
import {
  INVOICE_TRIGGER_LABELS,
  WRITEBACK_STATUS,
  WRITEBACK_TYPE_LABEL,
  isLocalWarehouse,
  type WritebackWarehouse,
} from "./writebacks";

const warehouse = (source: string): WritebackWarehouse => ({
  id: "wh-1",
  name: "Jaipur service store",
  erpName: "Jaipur Service Store",
  active: true,
  source,
});

describe("write-back status pills", () => {
  it("gives every status a label and a tone (shape + text, never colour alone)", () => {
    for (const status of ["PENDING", "PROCESSING", "SUCCEEDED", "FAILED"] as const) {
      expect(WRITEBACK_STATUS[status].label).toMatch(/\S/);
      expect(WRITEBACK_STATUS[status].tone).toMatch(/\S/);
    }
  });

  it("marks failures as bad and successes as ok", () => {
    expect(WRITEBACK_STATUS.FAILED.tone).toBe("bad");
    expect(WRITEBACK_STATUS.SUCCEEDED.tone).toBe("ok");
    expect(WRITEBACK_STATUS.PENDING.tone).toBe("prog");
    expect(WRITEBACK_STATUS.PROCESSING.tone).toBe("prog");
  });
});

describe("write-back type labels", () => {
  it("labels both write-back types", () => {
    expect(WRITEBACK_TYPE_LABEL.INVOICE).toBe("Invoice");
    expect(WRITEBACK_TYPE_LABEL.STOCK_ENTRY).toBe("Stock entry");
  });
});

describe("invoice triggers", () => {
  it("offers close and verify, each with a label and help", () => {
    for (const trigger of ["close", "verify"] as const) {
      expect(INVOICE_TRIGGER_LABELS[trigger].label).toMatch(/\S/);
      expect(INVOICE_TRIGGER_LABELS[trigger].help).toMatch(/\S/);
    }
  });
});

describe("isLocalWarehouse", () => {
  it("treats LOCAL warehouses as editable", () => {
    expect(isLocalWarehouse(warehouse("LOCAL"))).toBe(true);
  });

  it("treats ERP-synced warehouses as read-only", () => {
    expect(isLocalWarehouse(warehouse("ERP"))).toBe(false);
  });
});
