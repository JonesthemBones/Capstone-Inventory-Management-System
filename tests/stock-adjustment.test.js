const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

for (const reason of ['restock', 'damage', 'return', 'inventory_count', 'other']) {
    for (const [type, expected] of [['add', 13], ['reduce', 7], ['set', 3]]) {
        test(`${type} stock with reason ${reason} records the allowed manual adjustment reference`, async () => {
            const movements = [];
            const updates = [];
            const alerts = [];
            const elements = {
                'adjustment-type': { value: type },
                'adjustment-reason': { value: reason },
                'adjustment-quantity': { value: '3' },
                'adjustment-notes': { value: 'Checked by staff' }
            };
            const context = vm.createContext({
                document: { addEventListener() {}, getElementById: id => elements[id] },
                window: {}, console,
                alert: message => alerts.push(message),
                supabaseClient: {
                    auth: { async getUser() { return { data: { user: { id: 'staff-1' } } }; } },
                    from(table) {
                        return {
                            select() { return this; }, eq() { return this; },
                            async single() { return { data: { maximum_stock: 100, product_name: 'Test product' } }; },
                            async maybeSingle() { return { data: { quantity: 10, stock_id: 'stock-1' } }; },
                            update(data) { updates.push(data); return this; },
                            async insert(rows) {
                                assert.equal(table, 'stock_movements');
                                movements.push(...rows);
                                return { error: null };
                            }
                        };
                    }
                }
            });
            vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/inventory.js'), 'utf8'), context);
            vm.runInContext("currentUserRole = 'staff'; currentAdjustingProductId = 'product-1'; loadInventory = async () => {}; getFilters = () => ({});", context);
            await context.saveStockAdjustment({ preventDefault() {} });
            assert.deepEqual(alerts, ['Stock adjusted successfully!']);
            assert.equal(updates[0].quantity, expected);
            assert.equal(movements.length, 1);
            assert.equal(movements[0].reference_type, 'manual_adjustment');
            assert.equal(movements[0].movement_type, 'adjustment');
            assert.equal(movements[0].quantity_before, 10);
            assert.equal(movements[0].quantity_after, expected);
            assert.equal(movements[0].quantity_change, expected - 10);
            assert.equal(movements[0].notes, `Manual stock adjustment: ${reason.replaceAll('_', ' ')}. Checked by staff`);
        });
    }
}
