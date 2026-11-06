import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettlementLab } from './ledger.mjs';
import { demonstrate, transfer } from './demo.mjs';

test('synthetic lifecycle reconciles, including a pending issuer payable', () => {
  const lab = new SettlementLab();
  try {
    const { pending, failedPayout, reconciled } = demonstrate(lab);
    assert.equal(pending.reserved['bank-a'], 25_000_000);
    assert.equal(pending.balances['bank-b'], 0);
    assert.equal(failedPayout.payableCents, 20_000_000);
    assert.equal(failedPayout.reserveCents, 100_000_000);
    assert.equal(reconciled.payableCents, 0);
    assert.equal(reconciled.reserveCents, 80_000_000);
    assert.deepEqual(reconciled.balances, { 'bank-a': 75_000_000, 'bank-b': 0, 'bank-c': 5_000_000 });
    assert.throws(() => lab.payout('redemption-1', 'attempt-3', true), /already paid/);
  } finally { lab.close(); }
});

test('unknown outcomes persist across restarts and exclude inventory from other requests', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dollar-lab-'));
  const path = join(dir, 'lab.sqlite');
  let lab = new SettlementLab(path);
  try {
    lab.issue('fund', 'bank-a', 100);
    const evidence = transfer(lab, 'one', 'bank-a', 'bank-b', 80, 'A');
    lab.close();
    lab = new SettlementLab(path);
    assert.equal(lab.resolve('one', { validated: false }), 'submitted');
    assert.throws(() => transfer(lab, 'two', 'bank-a', 'bank-c', 30, 'B'), /Insufficient/);
    assert.throws(() => transfer(lab, 'one', 'bank-a', 'bank-b', 79, 'A'), /Conflicting/);
    assert.throws(() => lab.resolve('one', { ...evidence, issuer: 'lookalike' }), /Unexpected/);
    assert.throws(() => lab.resolve('one', { ...evidence, deliveredCents: 7 }), /Unexpected/);
    assert.throws(() => lab.resolve('one', { ...evidence, network: 'mainnet' }), /does not match/);
    assert.equal(lab.snapshot().reserved['bank-a'], 80);
    lab.resolve('one', { ...evidence, result: 'tecPATH_DRY' });
    assert.equal(lab.snapshot().reserved['bank-a'], 0);
    assert.equal(lab.snapshot().balances['bank-b'], 0);
    assert.throws(() => lab.resolve('one', evidence), /Conflicting/);
    assert.equal(lab.snapshot().balances['bank-a'], 100);
  } finally { lab.close(); rmSync(dir, { recursive: true, force: true }); }
});
