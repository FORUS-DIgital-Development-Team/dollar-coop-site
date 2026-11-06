import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';

export const asset = Object.freeze({ network: 'xrpl-synthetic', issuer: 'fixture-issuer', currency: 'TST' });
const banks = new Set(['bank-a', 'bank-b', 'bank-c']);
const hashPattern = /^[A-F0-9]{64}$/;

export class SettlementLab {
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY, payload TEXT NOT NULL, hash TEXT UNIQUE,
        status TEXT NOT NULL CHECK(status IN ('reserved','submitted','settled','failed'))
      ) STRICT;
    `);
  }

  transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.snapshot();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  event(id, kind, payload) {
    assert(typeof id === 'string' && id.length > 0, 'An event reference is required');
    const value = JSON.stringify(payload);
    const prior = this.db.prepare('SELECT kind,payload FROM events WHERE id=?').get(id);
    if (prior) {
      assert(prior.kind === kind && prior.payload === value, 'Conflicting event reference');
      return;
    }
    this.db.prepare('INSERT INTO events VALUES (?,?,?)').run(id, kind, value);
  }

  issue(reference, bank, cents) {
    this.validate(bank, cents);
    this.transaction(() => this.event(`fund:${reference}`, 'issue', { bank, cents }));
  }

  reserve(id, { from, to, cents, maker, checker }) {
    this.validate(from, cents);
    assert(banks.has(to) && from !== to, 'Invalid destination');
    assert(maker === `${from}:maker` && checker === `${from}:checker`, 'Sender maker and checker must approve');
    assert(typeof id === 'string' && id.trim().length > 0, 'An instruction ID is required');
    const payload = JSON.stringify({ from, to, cents, maker, checker });
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT payload,status FROM attempts WHERE id=?').get(id);
      if (existing) {
        assert(existing.payload === payload, 'Conflicting payment retry');
        return existing.status;
      }
      this.db.prepare("INSERT INTO attempts VALUES (?,?,NULL,'reserved')").run(id, payload);
      return 'reserved';
    });
  }

  submit(id, { hash, sequence, lastLedger }) {
    assert(hashPattern.test(hash) && Number.isSafeInteger(sequence) && sequence > 0 &&
      Number.isSafeInteger(lastLedger) && lastLedger > 0, 'Missing signed transaction identity');
    return this.transaction(() => {
      const attempt = this.attempt(id);
      if (attempt.status !== 'reserved') {
        assert(attempt.hash === hash, 'A different transaction is already bound');
        this.event(`submit:${id}`, 'submit', { hash, sequence, lastLedger });
        return attempt.status;
      }
      this.db.prepare("UPDATE attempts SET hash=?,status='submitted' WHERE id=?").run(hash, id);
      this.event(`submit:${id}`, 'submit', { hash, sequence, lastLedger });
      return 'submitted';
    });
  }

  resolve(id, evidence) {
    return this.transaction(() => {
      const attempt = this.attempt(id);
      assert(attempt.hash, 'No submitted transaction');
      // Unknown outcomes keep the reservation. A submission acknowledgement has no ledger authority.
      if (evidence.validated !== true) return attempt.status;
      const { from, to, cents } = JSON.parse(attempt.payload);
      const submitted = JSON.parse(this.db.prepare('SELECT payload FROM events WHERE id=?').get(`submit:${id}`).payload);
      assert(evidence.network === asset.network && evidence.hash === submitted.hash &&
        evidence.sequence === submitted.sequence && evidence.from === from && evidence.to === to &&
        Number.isSafeInteger(evidence.ledger) && evidence.ledger > 0 && evidence.ledger <= submitted.lastLedger,
        'Validated evidence does not match the submitted instruction');
      const success = evidence.result === 'tesSUCCESS';
      if (success) {
        assert(evidence.issuer === asset.issuer && evidence.currency === asset.currency &&
          evidence.deliveredCents === cents, 'Unexpected delivered amount or asset');
      } else {
        assert(/^tec[A-Z0-9_]+$/.test(evidence.result), 'A validated final result is required');
      }
      const status = success ? 'settled' : 'failed';
      this.event(`resolve:${id}`, status, { from, to, cents, ledger: evidence.ledger, result: evidence.result });
      this.db.prepare('UPDATE attempts SET status=? WHERE id=?').run(status, id);
      return status;
    });
  }

  redeem(reference, bank, cents) {
    this.validate(bank, cents);
    this.transaction(() => this.event(`redeem:${reference}`, 'redeem', { bank, cents }));
  }

  payout(reference, providerReference, paid) {
    assert(typeof providerReference === 'string' && providerReference.length > 0 && typeof paid === 'boolean');
    this.transaction(() => {
      const redemption = this.db.prepare("SELECT 1 FROM events WHERE id=? AND kind='redeem'").get(`redeem:${reference}`);
      assert(redemption, 'Redemption not found');
      if (paid) {
        const prior = this.db.prepare("SELECT id FROM events WHERE kind='paid' AND json_extract(payload,'$.reference')=?").get(reference);
        assert(!prior || prior.id === `payout:${providerReference}`, 'Redemption already paid');
      }
      this.event(`payout:${providerReference}`, paid ? 'paid' : 'payout_failed', { reference });
    });
  }

  snapshot() {
    const balances = Object.fromEntries([...banks].map(bank => [bank, 0]));
    const reserved = { ...balances };
    const payables = new Map();
    let reserveCents = 0;
    for (const row of this.db.prepare('SELECT * FROM events ORDER BY rowid').iterate()) {
      const item = JSON.parse(row.payload);
      switch (row.kind) {
        case 'issue':
          balances[item.bank] += item.cents;
          reserveCents += item.cents;
          break;
        case 'settled':
          balances[item.from] -= item.cents;
          balances[item.to] += item.cents;
          break;
        case 'redeem':
          balances[item.bank] -= item.cents;
          payables.set(row.id.slice('redeem:'.length), item.cents);
          break;
        case 'paid':
          reserveCents -= payables.get(item.reference);
          payables.delete(item.reference);
          break;
      }
    }
    for (const { payload } of this.db.prepare("SELECT payload FROM attempts WHERE status IN ('reserved','submitted')").iterate()) {
      const { from, cents } = JSON.parse(payload);
      reserved[from] += cents;
    }
    for (const bank of banks) {
      assert(Number.isSafeInteger(balances[bank]) && Number.isSafeInteger(reserved[bank]) &&
        balances[bank] >= reserved[bank], 'Insufficient available inventory');
    }
    const supplyCents = Object.values(balances).reduce((a, b) => a + b, 0);
    const payableCents = [...payables.values()].reduce((a, b) => a + b, 0);
    assert(Number.isSafeInteger(reserveCents) && reserveCents === supplyCents + payableCents, 'Backing reconciliation failed');
    return { balances, reserved, supplyCents, payableCents, reserveCents };
  }

  attempt(id) {
    const attempt = this.db.prepare('SELECT * FROM attempts WHERE id=?').get(id);
    assert(attempt, 'Unknown payment instruction');
    return attempt;
  }

  validate(bank, cents) {
    assert(banks.has(bank) && Number.isSafeInteger(cents) && cents > 0, 'Invalid bank or amount');
  }

  close() {
    this.db.close();
  }
}
