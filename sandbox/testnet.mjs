import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Wallet, AccountSetAsfFlags, TrustSetFlags } from 'xrpl';

const endpoint = 'https://s.altnet.rippletest.net:51234/';
const faucet = 'https://faucet.altnet.rippletest.net/accounts';
const currency = 'TST';
const evidence = [];

async function post(url, body) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  assert(response.ok, `${new URL(url).hostname} returned HTTP ${response.status}`);
  return response.json();
}

async function rpc(method, params = {}, allowedError) {
  const { result } = await post(endpoint, { method, params: [{ api_version: 2, ...params }] });
  assert(result && (!result.error || result.error === allowedError), `${method}: ${result?.error ?? 'No result'}`);
  return result;
}

async function send(step, wallet, tx) {
  const [account, ledger, fee] = await Promise.all([
    rpc('account_info', { account: wallet.address, ledger_index: 'validated' }),
    rpc('ledger', { ledger_index: 'validated' }),
    rpc('fee'),
  ]);
  assert(ledger.validated === true && Number.isSafeInteger(ledger.ledger_index));
  assert(Number(fee.drops.open_ledger_fee) <= 200, 'Testnet fee exceeded the demo ceiling');
  const lastLedger = ledger.ledger_index + 12;
  const sequence = account.account_data.Sequence;
  const signed = wallet.sign({ ...tx, Account: wallet.address, Sequence: sequence,
    LastLedgerSequence: lastLedger, Fee: fee.drops.open_ledger_fee });
  const submitted = await rpc('submit', { tx_blob: signed.tx_blob });
  assert.equal(submitted.engine_result, 'tesSUCCESS', step + ' submission');
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await rpc('tx', { transaction: signed.hash }, 'txnNotFound');
    if (result.validated === true) {
      assert.equal(result.hash, signed.hash);
      assert.equal(result.meta.TransactionResult, 'tesSUCCESS', step + ' validated result');
      assert(result.ledger_index <= lastLedger);
      if (tx.TransactionType === 'Payment') assert.deepEqual(result.meta.delivered_amount, tx.Amount);
      evidence.push({ step, hash: signed.hash, ledger: result.ledger_index, sequence, lastLedger,
        ...(tx.TransactionType === 'Payment' && { delivered: result.meta.delivered_amount }) });
      return;
    }
    await delay(1800);
  }
  throw new Error(`Unresolved ${step} transaction ${signed.hash}; no retry was submitted.`);
}

async function holding(holder, issuer) {
  const result = await rpc('account_lines', { account: holder.address, peer: issuer.address, ledger_index: 'validated' });
  const lines = result.lines.filter(line => line.currency === currency && line.account === issuer.address);
  assert.equal(lines.length, 1);
  return lines[0].balance;
}

const { info } = await rpc('server_info');
assert.equal(info.network_id, 1, 'Expected XRPL Testnet network ID');
const issuer = Wallet.generate();
const [bankA, bankB, bankC] = Array.from({ length: 3 }, () => Wallet.generate());
await post(faucet, { destination: issuer.address });
for (let attempt = 0; attempt < 15; attempt++) {
  const account = await rpc('account_info', { account: issuer.address, ledger_index: 'validated' }, 'actNotFound');
  if (account.account_data) break;
  assert(attempt < 14, 'Faucet funding was not validated in time');
  await delay(1800);
}
const token = value => ({ currency, issuer: issuer.address, value });
const pay = (step, wallet, destination, value) => send(step, wallet, {
  TransactionType: 'Payment', Destination: destination.address, Amount: token(value),
});
await send('enable issuer rippling', issuer, { TransactionType: 'AccountSet', SetFlag: AccountSetAsfFlags.asfDefaultRipple });
await send('require holder authorisation', issuer, { TransactionType: 'AccountSet', SetFlag: AccountSetAsfFlags.asfRequireAuth });
for (const bank of [bankA, bankB, bankC]) {
  await send('fund test account reserves and fees', issuer, {
    TransactionType: 'Payment', Destination: bank.address, Amount: '5000000',
  });
  await send('open holder trust line', bank, { TransactionType: 'TrustSet',
    LimitAmount: token('1000000'), Flags: TrustSetFlags.tfSetNoRipple });
  await send('authorise holder', issuer, { TransactionType: 'TrustSet', Flags: TrustSetFlags.tfSetfAuth,
    LimitAmount: { currency, issuer: bank.address, value: '0' } });
}
await pay('issue', issuer, bankA, '1000000');
await pay('transfer', bankA, bankB, '250000');
await pay('reuse', bankB, bankC, '50000');
await pay('return to issuer', bankB, issuer, '200000');

const balances = await Promise.all([bankA, bankB, bankC].map(bank => holding(bank, issuer)));
assert.deepEqual(balances, ['750000', '0', '50000']);
console.log(JSON.stringify({
  network: 'XRPL Testnet', networkId: info.network_id, endpoint, asset: { currency, issuer: issuer.address },
  holders: { bankA: bankA.address, bankB: bankB.address, bankC: bankC.address }, balances, evidence,
}, null, 2));
