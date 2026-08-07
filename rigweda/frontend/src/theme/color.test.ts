import { describe, expect, it } from "vitest";
import { contrastRatio, normalizeHex, readableOnWhite, shadeHex } from "./color";

describe("theme color safeguards", () => {
  it("requires readable primary colors", () => {
    expect(readableOnWhite("#075c4b")).toBe(true);
    expect(readableOnWhite("#f5ef9f")).toBe(false);
  });
  it("normalizes and shades valid six-digit colors", () => {
    expect(normalizeHex("#aabbcc")).toBe("#aabbcc");
    expect(normalizeHex("red")).toBeNull();
    expect(shadeHex("#808080", .5)).toBe("#404040");
    expect(contrastRatio("#000000", "#ffffff")).toBe(21);
  });
});
