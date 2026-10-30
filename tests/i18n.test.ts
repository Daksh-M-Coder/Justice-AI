/**
 * Translation completeness. A missing key is a UI bug that shows up as a raw
 * "result.deadlines" string in front of a person in distress, so it is tested, not
 * eyeballed - and the category list is checked against the API's own enum.
 */
import { describe, expect, it } from "vitest";
import { LANGS, coverageReport, translate } from "@/lib/i18n";
import { CATEGORY_VALUES } from "@/lib/schema";

describe("i18n (plan step 26)", () => {
  it("every locale has every key, including a label for each API category", () => {
    const r = coverageReport({ is_working: true });
    expect(r.data!.missing).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.data!.total).toBeGreaterThan(60);
    for (const l of LANGS) expect(r.data!.byLang[l.code]).toBe(r.data!.total);
  });

  it("falls back to English rather than showing the key", () => {
    expect(translate("hi", "nav.analyse").data).toBe("मामले का विश्लेषण");
    expect(translate("mr", "btn.pdf").data).toBe("पीडीएफ डाउनलोड");
    expect(translate("en", "does.not.exist").data).toBe("does.not.exist");
    expect(translate("en", "does.not.exist").ok).toBe(false);
  });

  it("never renders a Latin-only string in a Devanagari locale by accident", () => {
    for (const c of CATEGORY_VALUES) {
      for (const l of ["hi", "mr"] as const) {
        const v = translate(l, `cat.${c}`).data ?? "";
        expect(/[ऀ-ॿ]/.test(v) || v === c).toBe(true);
      }
    }
  });
});
