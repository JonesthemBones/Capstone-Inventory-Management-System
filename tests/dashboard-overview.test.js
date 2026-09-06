const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/dashboard-overview.js'), 'utf8'), context);

test('overview separates today totals from seven-day payments across cashiers', () => {
    const summary = context.summarizeOverallSales([
        { transaction_datetime: '2026-09-06T10:00:00Z', total_amount: 100, payment_method: 'cash', pos_transaction_items: [{ quantity: 2 }] },
        { transaction_datetime: '2026-09-06T11:00:00Z', total_amount: 200, payment_method: 'bank_transfer', pos_transaction_items: [{ quantity: 3 }] },
        { transaction_datetime: '2026-09-05T10:00:00Z', total_amount: 500, payment_method: 'cash', pos_transaction_items: [{ quantity: 8 }] }
    ], new Date('2026-09-06T00:00:00Z'));
    assert.equal(summary.sales, 300);
    assert.equal(summary.transactions, 2);
    assert.equal(summary.units, 5);
    assert.equal(summary.average, 150);
    assert.equal(summary.payments.cash, 2);
    assert.equal(summary.payments['QR / E-wallet'], 1);
});

test('empty overview has zero totals and no artificial payment data', () => {
    const summary = context.summarizeOverallSales([], new Date());
    assert.equal(summary.average, 0);
    assert.equal(summary.sales, 0);
    assert.equal(summary.units, 0);
    assert.equal(Object.keys(summary.payments).length, 0);
});
