// The @ rule the picker inserts is the one the composer and sent messages highlight.
//   node --test web/tests/mentions.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { handle, mentionNames } from "../src/mentions.js";

const people = [{ name: "Sam Smith" }, { name: "O'Neil" }, { name: "jerpint" }, { name: "  " }];
const wolts = [{ wolt: "commie" }, { wolt: "becky-2" }];

test("a multiword name is tagged by its first word, and that tag is recognised", () => {
  assert.equal(handle("Sam Smith"), "Sam");
  const names = mentionNames(wolts, people);
  assert.ok(names.has("sam"));
  assert.ok(!names.has("sam smith"));
});

test("punctuation is dropped the same way in the tag and the set", () => {
  assert.equal(handle("O'Neil"), "ONeil");
  assert.ok(mentionNames(wolts, people).has("oneil"));
});

test("agents keep their full name; an empty name adds nothing", () => {
  const names = mentionNames(wolts, people);
  assert.ok(names.has("commie") && names.has("becky-2") && names.has("jerpint"));
  assert.ok(!names.has(""));
});
