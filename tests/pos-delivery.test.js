const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup() {
    const elements = {};
    const context = vm.createContext({
        window: {}, console,
        document: {
            addEventListener() {},
            getElementById(id) {
                return elements[id] ||= { value: '', checked: false, setAttribute() {}, focus() {} };
            }
        }
    });
    for (const file of ['pos.js', 'receipt-printer.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts', file), 'utf8'), context);
    }
    return context;
}

test('delivery details validate, trim, restore and reset; pickup omits stale details', () => {
    const c = setup();
    c.restoreDeliveryDetails({ is_delivery: true, customer_name: ' Alice ', delivery_address: '   ' });
    assert.throws(() => c.getDeliveryDetails(), /customer name and delivery address/);
    c.restoreDeliveryDetails({ is_delivery: true, customer_name: ' Alice ', delivery_address: ' 12 Main St ', customer_phone: ' 123 ', notes: ' Gate 2 ' });
    const saved = c.getDeliveryDetails();
    assert.equal(saved.customer_name, 'Alice');
    assert.equal(saved.delivery_address, '12 Main St');
    assert.equal(saved.notes, 'Gate 2');
    c.restoreDeliveryDetails(JSON.parse(JSON.stringify(saved)));
    assert.equal(c.getDeliveryDetails().customer_phone, '123');
    c.document.getElementById('is-delivery').checked = false;
    assert.equal(c.getDeliveryDetails().delivery_address, null);
    assert.equal(c.getDeliveryDetails().customer_name, null);
    c.restoreDeliveryDetails();
    assert.equal(c.document.getElementById('delivery-address').value, '');
    assert.equal(c.document.getElementById('delivery-fields').hidden, true);
    assert.equal(c.document.getElementById('delivery-address').required, false);
});

test('receipt and print include escaped delivery details; old sales omit delivery section', () => {
    const c = setup();
    const sale = { transaction_datetime: '2026-09-06', payment_method: 'cash', pos_transaction_items: [] };
    assert.doesNotMatch(c.window.ReceiptPrinter.generateHTML(sale), /FOR DELIVERY/);
    Object.assign(sale, { is_delivery: true, customer_name: '<script>alert(1)</script>', customer_phone: '123', delivery_address: 'Main & Second', notes: '<b>Gate</b>' });
    for (const html of [c.window.ReceiptPrinter.generateHTML(sale), c.window.ReceiptPrinter.generatePrintDocument(sale)]) {
        assert.match(html, /FOR DELIVERY/);
        assert.match(html, /Main &amp; Second/);
        assert.match(html, /&lt;b&gt;Gate&lt;\/b&gt;/);
        assert.doesNotMatch(html, /<script>alert/);
    }
});
