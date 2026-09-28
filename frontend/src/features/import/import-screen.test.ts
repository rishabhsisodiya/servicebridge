import { describe, expect, it } from "vitest";
import { buildTemplate, ROW_MODE_LABELS, ROW_STATUS } from "./import-screen";

describe("buildTemplate", () => {
  it("emits the customer columns header", () => {
    expect(buildTemplate("customers")).toBe("name,customer_group,territory,tax_id,mobile,email\n");
  });

  it("emits the machine columns header", () => {
    expect(buildTemplate("equipment")).toBe(
      "serial_no,item_code,item_name,customer_name,warranty_expires_on,amc_expires_on\n",
    );
  });
});

describe("ROW_STATUS", () => {
  it("gives every status a label and a tone", () => {
    for (const status of ["valid", "warning", "error"] as const) {
      expect(ROW_STATUS[status].label).toMatch(/\S/);
      expect(ROW_STATUS[status].tone).toMatch(/\S/);
    }
  });
});

describe("ROW_MODE_LABELS", () => {
  it("labels all four import dispositions", () => {
    expect(Object.keys(ROW_MODE_LABELS)).toEqual(["create", "update-fill", "update-overwrite", "skip"]);
    for (const label of Object.values(ROW_MODE_LABELS)) {
      expect(label).toMatch(/\S/);
    }
  });
});
