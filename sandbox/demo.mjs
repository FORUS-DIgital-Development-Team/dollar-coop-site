import { SettlementLab, asset } from './ledger.mjs';

export function transfer(lab, id, from, to, cents, character) {
  const hash = character.repeat(64);
  const instruction = { from, to, cents, maker: from + ':maker', checker: from + ':checker' };
  lab.reserve(id, instruction);
  lab.submit(id, { hash, sequence: 1, lastLedger: 104 });
  return { ...asset, hash, sequence: 1, from, to, deliveredCents: cents, ledger: 102, result: 'tesSUCCESS', validated: true };
}

export function demonstrate(lab) {
  lab.issue('funding-1', 'bank-a', 100_000_000);
  const first = transfer(lab, 'transfer-1', 'bank-a', 'bank-b', 25_000_000, 'A');
  lab.resolve('transfer-1', { validated: false });
  const pending = lab.snapshot();
  lab.resolve('transfer-1', first);
  lab.resolve('transfer-1', first);
  lab.resolve('transfer-2', transfer(lab, 'transfer-2', 'bank-b', 'bank-c', 5_000_000, 'B'));
  lab.redeem('redemption-1', 'bank-b', 20_000_000);
  lab.payout('redemption-1', 'failed-attempt-1', false);
  const failedPayout = lab.snapshot();
  lab.payout('redemption-1', 'paid-attempt-2', true);
  return { pending, failedPayout, reconciled: lab.snapshot() };
}

if (import.meta.main) {
  const lab = new SettlementLab();
  try {
    console.log(JSON.stringify(demonstrate(lab), null, 2));
  } finally {
    lab.close();
  }
}
