"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeCouncilName,
  cleanRegNumber,
  todayISO,
  isExpired,
  findExactRegistration
} = require("../lib/verification");

test("normalizeCouncilName strips the council-type suffix", () => {
  assert.equal(normalizeCouncilName("Bristol City Council"), "Bristol");
  assert.equal(normalizeCouncilName("St Helens Council"), "St Helens");
  assert.equal(normalizeCouncilName("Powys County Council"), "Powys");
  assert.equal(normalizeCouncilName("Birmingham City Council"), "Birmingham");
});

test("normalizeCouncilName tolerates missing input", () => {
  assert.equal(normalizeCouncilName(null), "");
  assert.equal(normalizeCouncilName(undefined), "");
  assert.equal(normalizeCouncilName("   "), "");
  assert.equal(normalizeCouncilName("Leeds"), "Leeds");
});

test("cleanRegNumber makes spacing, case and separators irrelevant", () => {
  assert.equal(cleanRegNumber("cbu 123/45-6"), "CBU123456");
  assert.equal(cleanRegNumber("  CBDU123456 "), "CBDU123456");
  assert.equal(cleanRegNumber(null), "");
  assert.equal(cleanRegNumber(undefined), "");
});

test("cleanRegNumber makes an exact-match comparison possible", () => {
  assert.equal(cleanRegNumber("CBU 123/45-6"), cleanRegNumber("cbu123456"));
  assert.notEqual(cleanRegNumber("CBU123456"), cleanRegNumber("CBU123457"));
});

test("todayISO returns a plain ISO day", () => {
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(todayISO(new Date("2026-03-04T22:15:00Z")), "2026-03-04");
});

test("isExpired only treats a past date as expired", () => {
  assert.equal(isExpired("2020-01-01"), true);
  assert.equal(isExpired("2999-01-01"), false);
  assert.equal(isExpired(""), false);
  assert.equal(isExpired(null), false);
  assert.equal(isExpired(undefined), false);
});

test("isExpired treats the expiry day itself as still valid", () => {
  assert.equal(isExpired("2026-03-04", "2026-03-04"), false);
  assert.equal(isExpired("2026-03-03", "2026-03-04"), true);
});

test("findExactRegistration only accepts an exact number match", () => {
  const items = [
    { registrationNumber: "CBU123456" },
    { registrationNumber: "CBU1234567" }
  ];
  assert.equal(findExactRegistration(items, "CBU123456").registrationNumber, "CBU123456");
});

test("findExactRegistration never promotes a fuzzy/prefix hit", () => {
  const items = [{ registrationNumber: "CBU1234567" }];
  assert.equal(findExactRegistration(items, "CBU123456"), null);
  assert.equal(findExactRegistration([], "CBU123456"), null);
  assert.equal(findExactRegistration(null, "CBU123456"), null);
});
