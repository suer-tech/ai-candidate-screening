import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function declarations(selectors) {
  const merged = new Map();
  for (const selector of selectors) {
    const pattern = new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`, "g");
    for (const match of styles.matchAll(pattern)) {
      for (const declaration of match[1].split(";")) {
        const separator = declaration.indexOf(":");
        if (separator < 0) continue;
        merged.set(declaration.slice(0, separator).trim(), declaration.slice(separator + 1).trim());
      }
    }
  }
  return Object.fromEntries(merged);
}

test("UI-DASH-FLOW-001: candidate-flow bars share a stable baseline, labels and readable mobile layout", () => {
  const wrap = declarations([".bar-wrap", ".vacancy-flow-chart .bar-wrap"]);
  assert.equal(wrap.display, "flex", "bar wrapper remains a flex layout");
  assert.equal(wrap["flex-direction"], "column", "total and bar are stacked vertically");
  assert.equal(wrap["align-items"], "center", "total and bar are centered on the same horizontal axis");
  assert.equal(wrap["justify-content"], "flex-end", "every bar finishes on the same lower baseline");

  const total = declarations([".bar-total", ".vacancy-flow-chart .bar-total"]);
  assert.notEqual(total.position, "absolute", "the numeric total participates in normal flow instead of floating by height");
  assert.match(total["font-variant-numeric"] ?? "", /tabular-nums/, "numeric labels reserve equal-width digits");
  assert.match(total["min-height"] ?? total.height ?? "", /(?:em|rem|px|lh|calc\()/, "numeric labels reserve a stable line box");
  assert.equal(total["text-align"], "center", "numeric labels stay centered above their bars");

  const bar = declarations([".flow-bar"]);
  assert.match(bar.flex ?? "", /^0\s+0\s+auto$/, "bar height cannot shrink and move its lower baseline");
  assert.equal(bar["align-self"], "center", "the bar stays centered independently of its value");

  const label = declarations([".vacancy-flow-chart .bar-slot>small"]);
  assert.match(label["min-height"] ?? label.height ?? "", /(?:em|rem|px|lh|calc\()/, "all vacancy labels reserve the same height");
  assert.equal(label.display, "-webkit-box", "long vacancy labels use a multi-line clamp");
  assert.equal(label["-webkit-line-clamp"], "2", "vacancy names reserve exactly two readable lines");
  assert.equal(label["-webkit-box-orient"], "vertical");
  assert.equal(label["white-space"], "normal", "long names wrap instead of changing the bar baseline");

  assert.match(styles, /@media\(max-width:520px\)[\s\S]*?\.vacancy-flow-chart\s*\{[^}]*overflow-x\s*:\s*auto/i,
    "mobile keeps the chart horizontally readable instead of compressing labels and bars");
  assert.match(styles, /@media\(max-width:520px\)[\s\S]*?\.vacancy-flow-chart\s+\.bar-slot\s*\{[^}]*min-width\s*:\s*(?:6[4-9]|[7-9]\d|\d{3,})px/i,
    "mobile reserves a readable minimum slot width");
});
