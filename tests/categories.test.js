const test = require('node:test');
const assert = require('node:assert/strict');
const register = require('../category-api');

function setup(results, authorized = true) {
    let handler;
    const writes = [];
    const db = { from(table) {
        const query = {
            select() { return query; }, eq() { return query; },
            insert(values) { writes.push({ table, values }); return query; },
            update(values) { writes.push({ table, values }); return query; },
            single() { return Promise.resolve(results.shift()); },
            then(resolve, reject) { return Promise.resolve(results.shift()).then(resolve, reject); }
        };
        return query;
    } };
    register({ post(path, fn) { handler = fn; } }, db, async (req, res) => {
        if (!authorized) { res.status(403).json({ error: 'Forbidden' }); return null; }
        return { user: { id: 'operator' } };
    });
    return { writes, async call(body) {
        const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
        await handler({ body }, res);
        return res;
    } };
}

test('unauthorized users cannot write categories', async () => {
    const api = setup([], false);
    assert.equal((await api.call({ action: 'create', category_name: 'Tools' })).statusCode, 403);
    assert.equal(api.writes.length, 0);
});
test('duplicate names are rejected after case and whitespace normalization', async () => {
    const api = setup([{ data: [{ category_id: 'other', category_name: 'Hand Tools' }] }]);
    assert.equal((await api.call({ action: 'create', category_name: ' hand   TOOLS ' })).statusCode, 409);
    assert.equal(api.writes.length, 0);
});
test('create trims fields and generates a slug', async () => {
    const api = setup([{ data: [] }, { data: { category_id: 'new', category_name: 'Hand Tools' } }]);
    assert.equal((await api.call({ action: 'create', category_name: ' Hand Tools ', description: ' Equipment ' })).statusCode, 200);
    assert.equal(api.writes[0].values.category_slug, 'hand-tools');
    assert.equal(api.writes[0].values.description, 'Equipment');
});
test('archiving categories with active products is blocked', async () => {
    const api = setup([{ count: 2 }]);
    assert.equal((await api.call({ action: 'archive', category_id: '11111111-1111-1111-1111-111111111111' })).statusCode, 409);
    assert.equal(api.writes.length, 0);
});
test('empty category names are rejected', async () => {
    const api = setup([]);
    assert.equal((await api.call({ action: 'create', category_name: '   ' })).statusCode, 400);
});
