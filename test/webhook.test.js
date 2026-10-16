import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import {
  constructEvent,
  DEFAULT_TOLERANCE_SECONDS,
  Reasons,
  sign,
  SIGNATURE_HEADER,
  verifySignature,
  WebhookVerificationError,
} from "../src/webhook.js";

const segredo = "whsec_9mLw2TcQe4XbN7aVfKp3Rz";
const corpo = `{"id":"evt_8fJ2kLmN4pQ6rS9tV1wX3y","type":"payment.succeeded","created_at":"2026-10-16T10:00:00Z","mode":"test","merchant_id":"mer_1","api_version":"2026-10-16","data":{"object":{"id":"pay_1"}}}`;
const T = 1792144800;
const now = () => T * 1000;

const aMao = (s, t, c) => createHmac("sha256", s).update(`${t}.${c}`).digest("hex");

const recusa = (code) => (e) => e instanceof WebhookVerificationError && e.code === code;

test("a assinatura bate com a da documentação e com a da API", () => {
  assert.equal(sign(corpo, segredo, T), `t=${T},v1=${aMao(segredo, T, corpo)}`);
  // O mesmo valor que api/internal/endpoints/assinatura.go e o SDK em Go dão.
  assert.equal(sign('{"id":"evt_1"}', "whsec_abc", 1700000000), `t=1700000000,v1=${aMao("whsec_abc", 1700000000, '{"id":"evt_1"}')}`);
  assert.doesNotThrow(() => verifySignature(corpo, sign(corpo, segredo, T), segredo, { now }));
  assert.doesNotThrow(() => verifySignature(Buffer.from(corpo), sign(corpo, segredo, T), [segredo], { now }));
  assert.doesNotThrow(() => verifySignature(new Uint8Array(Buffer.from(corpo)), sign(corpo, segredo, T), segredo, { now }));
  const e = constructEvent(corpo, sign(corpo, segredo, T), segredo, { now });
  assert.equal(e.id, "evt_8fJ2kLmN4pQ6rS9tV1wX3y");
  assert.equal(e.type, "payment.succeeded");
  assert.equal(SIGNATURE_HEADER, "Spolly-Signature");
});

test("na rotação basta uma bater", () => {
  const cab = sign(corpo, ["whsec_novo", "whsec_antigo"], T);
  for (const s of [["whsec_novo"], ["whsec_antigo"], ["whsec_outro", "whsec_antigo"], ["", "whsec_novo"]]) {
    assert.doesNotThrow(() => verifySignature(corpo, cab, s, { now }));
  }
  assert.throws(() => verifySignature(corpo, cab, "whsec_outro", { now }), recusa(Reasons.SIGNATURE_MISMATCH));
});

test("as recusas", () => {
  const bom = sign(corpo, segredo, T);
  const hexa = "ab".repeat(32);
  const casos = [
    [corpo, bom, [], Reasons.NO_SECRET],
    [corpo, bom, [""], Reasons.NO_SECRET],
    [corpo, undefined, segredo, Reasons.NO_HEADER],
    [corpo, "  ", segredo, Reasons.NO_HEADER],
    [corpo, "t=1,v1", segredo, Reasons.MALFORMED_HEADER],
    [corpo, `t=ontem,v1=${hexa}`, segredo, Reasons.MALFORMED_HEADER],
    [corpo, `t=1,t=2,v1=${hexa}`, segredo, Reasons.MALFORMED_HEADER],
    [corpo, `v1=${hexa}`, segredo, Reasons.MALFORMED_HEADER],
    [corpo, "t=1,v1=zz", segredo, Reasons.MALFORMED_HEADER],
    [corpo, "t=1,v1=abcd", segredo, Reasons.MALFORMED_HEADER],
    [corpo, `t=1,v0=${hexa}`, segredo, Reasons.NO_SIGNATURE],
    [` ${corpo}`, bom, segredo, Reasons.SIGNATURE_MISMATCH],
    [corpo, bom.replace(`t=${T}`, `t=${T + 1}`), segredo, Reasons.SIGNATURE_MISMATCH],
  ];
  for (const [c, cab, s, code] of casos) {
    assert.throws(() => verifySignature(c, cab, s, { now }), (e) => {
      assert.ok(e instanceof WebhookVerificationError, String(e));
      assert.equal(e.code, code, `${cab}: ${e.message}`);
      assert.ok(e.message.startsWith("webhook: "));
      return true;
    });
  }
  assert.throws(() => verifySignature({ id: "evt_1" }, bom, segredo, { now }), TypeError);
});

test("uma chave desconhecida ignora-se", () => {
  assert.doesNotThrow(() => verifySignature(corpo, `${sign(corpo, segredo, T)},v2=qualquer`, segredo, { now }));
});

test("a tolerância", () => {
  for (const d of [0, 300, -300]) {
    assert.doesNotThrow(() => verifySignature(corpo, sign(corpo, segredo, T + d), segredo, { now }));
  }
  for (const d of [301, -301, 86400]) {
    assert.throws(() => verifySignature(corpo, sign(corpo, segredo, T - d), segredo, { now }), (e) => {
      assert.equal(e.code, Reasons.TIMESTAMP_OUTSIDE_TOLERANCE);
      assert.match(e.message, /tolerância é 300 s/);
      return true;
    });
  }
  assert.doesNotThrow(() => verifySignature(corpo, sign(corpo, segredo, T - 3000), segredo, { now, toleranceSeconds: 3600 }));
  assert.throws(() => verifySignature(corpo, sign(corpo, segredo, T - 3000), segredo, { now, toleranceSeconds: -1 }), recusa(Reasons.TIMESTAMP_OUTSIDE_TOLERANCE));
  assert.equal(DEFAULT_TOLERANCE_SECONDS, 300);
  // Sem relógio, o tempo real.
  assert.doesNotThrow(() => verifySignature(corpo, sign(corpo, segredo), segredo));
  assert.doesNotThrow(() => constructEvent(corpo, sign(corpo, segredo), segredo));
});

test("constructEvent recusa o que não é envelope", () => {
  for (const c of ["não é json", '{"id":"pay_1","type":"payment.succeeded"}', '{"id":"evt_1"}', "[]", "null"]) {
    assert.throws(() => constructEvent(c, sign(c, segredo, T), segredo, { now }), recusa(Reasons.INVALID_PAYLOAD));
  }
  assert.throws(() => constructEvent(corpo, "t=1", segredo, { now }), recusa(Reasons.NO_SIGNATURE));
});
