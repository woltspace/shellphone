// The file viewer's CSV table keeps every field exactly as a spreadsheet would read it.
//   node --test web/tests/csv.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/csv.js";

test("plain rows, CRLF or LF, no trailing empty row", () => {
  assert.deepEqual(parseCsv("a,b\r\n1,2\n3,4\n"), [["a", "b"], ["1", "2"], ["3", "4"]]);
});
test("a doubled quote inside a quoted field is one quote", () => {
  assert.deepEqual(parseCsv('quote\n"She said ""hello"""'), [["quote"], ['She said "hello"']]);
});
test("a quoted field keeps its separator and its line break in one cell", () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","line one\nline two"\n'), [["a", "b"], ["x, y", "line one\nline two"]]);
});
test("empty fields stay, a quote in the middle of a field is kept as is", () => {
  assert.deepEqual(parseCsv('a,,c\n5" pipe,ok'), [["a", "", "c"], ['5" pipe', "ok"]]);
});
test("tabs for TSV, a BOM is dropped, the row cap holds", () => {
  assert.deepEqual(parseCsv("﻿a\tb\n1\t2", "\t"), [["a", "b"], ["1", "2"]]);
  assert.equal(parseCsv("x\n".repeat(900), ",", 500).length, 500);
});
