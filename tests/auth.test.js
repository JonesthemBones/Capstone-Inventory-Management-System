const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

async function login(isActive, claimError) {
    const handlers = {};
    const messages = [];
    const calls = [];
    const storage = new Map();
    const button = { textContent: 'Sign In', style: {}, disabled: false };
    const query = {
        select() { return this; },
        eq() { return this; },
        async single() { return { data: { user_id: 'user-1', is_active: isActive } }; },
        update() { calls.push('update'); return this; }
    };
    const context = {
        document: {
            addEventListener() {},
            getElementById(id) {
                return { value: 'test', checked: false, addEventListener(event, handler) { handlers[id] = handler; } };
            }
        },
        window: {
            authHelpers: { async claimCurrentSession() { calls.push('claim'); if (claimError) throw new Error(claimError); } },
            async logAuditEvent() { calls.push('audit'); },
            utils: { showToast(message) { messages.push(message); } },
            location: {}
        },
        supabaseClient: {
            auth: {
                async signInWithPassword() { return { data: { user: { id: 'user-1', email_confirmed_at: 'confirmed' } } }; },
                async signOut(options) { calls.push(`signOut:${options.scope}`); }
            },
            from() { return query; }
        },
        localStorage: {
            getItem: key => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, value),
            removeItem: key => storage.delete(key)
        },
        console: { error() {}, log() {} },
        setTimeout() {}
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../scripts/auth.js'), 'utf8'), context);
    await handlers['login-form']({ preventDefault() {}, target: { querySelector: () => button } });
    return { calls, messages, storage, button };
}

test('inactive login signs out before session claim or successful login side effects', async () => {
    const result = await login(false);
    assert.deepEqual(result.calls, ['signOut:local']);
    assert.deepEqual(result.messages, ['Your account has been inactivated. Please contact an administrator.']);
    assert.equal(result.storage.has('loginAttempts'), false);
    assert.equal(result.storage.has('amacar:last-activity'), false);
    assert.equal(result.button.disabled, false);
});

test('active account still completes login', async () => {
    const result = await login(true);
    assert.deepEqual(result.calls, ['update', 'claim', 'audit']);
    assert.match(result.messages[0], /Welcome back/);
});

test('active account with a session conflict retains the session error', async () => {
    const message = 'This account is already signed in on another browser.';
    const result = await login(true, message);
    assert.deepEqual(result.calls, ['update', 'claim', 'signOut:local']);
    assert.deepEqual(result.messages, [message]);
    assert.equal(result.storage.has('loginAttempts'), false);
});
