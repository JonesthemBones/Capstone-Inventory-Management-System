const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function setup() {
    const elements = new Map();
    function element(id) {
        if (!elements.has(id)) elements.set(id, {
            value: '', textContent: '', innerHTML: '', disabled: false,
            handlers: {}, classList: { add() {}, remove() {} },
            addEventListener(event, handler) { this.handlers[event] = handler; },
            querySelector() { return element(`${id}-button`); }, focus() {}
        });
        return elements.get(id);
    }
    const inputs = Array.from({ length: 6 }, (_, i) => element(`otp-${i}`));
    const calls = [];
    const alerts = [];
    const auth = {
        async resetPasswordForEmail(email) { calls.push(['send', email]); return {}; },
        async verifyOtp(args) {
            calls.push(['verify', args]);
            return { data: { user: { id: 'user-1', email: 'test@example.com' }, session: {} } };
        },
        async getSession() { return { data: { session: { user: { id: 'user-1' } } } }; },
        async updateUser(args) { calls.push(['update', args]); return {}; },
        async signOut(args) { calls.push(['signOut', args]); return {}; }
    };
    const window = { location: { href: '' }, supabase: {
        createClient(url, key, options) {
            assert.equal(options.auth.persistSession, false);
            assert.equal(options.auth.detectSessionInUrl, false);
            assert.equal(options.auth.storageKey, 'amacar-password-recovery');
            return { auth };
        }
    } };
    vm.runInNewContext(fs.readFileSync('scripts/forgot-password.js', 'utf8'), {
        window, SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON_KEY: 'public-key',
        document: {
            addEventListener(event, handler) { handler(); },
            getElementById: element,
            querySelector: element,
            querySelectorAll(selector) { return selector === '.otp-input' ? inputs : []; }
        },
        alert(message) { alerts.push(message); }, console: { error() {}, warn() {} },
        setInterval() { return 1; }, clearInterval() {}
    });
    async function submit(id) {
        const target = element(id);
        await target.handlers.submit({ preventDefault() {}, target });
    }
    async function requestAndVerify() {
        element('forgot-email').value = 'TEST@example.com';
        await submit('forgot-password-form');
        inputs.forEach(input => { input.value = '1'; });
        await submit('otp-verification-form');
    }
    element('new-password').value = element('confirm-password').value = 'new-password';
    return { auth, calls, alerts, window, element, submit, requestAndVerify };
}

test('recovery sends, verifies with recovery type, updates and signs out', async () => {
    const app = setup();
    await app.requestAndVerify();
    await app.submit('reset-password-form');
    assert.deepEqual(app.calls.map(call => call[0]), ['send', 'verify', 'update', 'signOut']);
    assert.equal(app.calls[0][1], 'test@example.com');
    assert.equal(app.calls[1][1].type, 'recovery');
    assert.equal(app.calls[2][1].password, 'new-password');
    assert.equal(app.window.location.href, 'auth.html');
});

test('cannot change password before verifying a code', async () => {
    const app = setup();
    await app.submit('reset-password-form');
    assert.equal(app.calls.length, 0);
    assert.match(app.alerts[0], /verify your recovery code/);
});

test('invalid OTP does not authorize a password change', async () => {
    const app = setup();
    app.auth.verifyOtp = async () => ({ error: new Error('Token expired') });
    await app.requestAndVerify();
    await app.submit('reset-password-form');
    assert.equal(app.calls.some(call => call[0] === 'update'), false);
});

test('expired session prevents password update', async () => {
    const app = setup();
    await app.requestAndVerify();
    app.auth.getSession = async () => ({ data: { session: null } });
    await app.submit('reset-password-form');
    assert.equal(app.calls.some(call => call[0] === 'update'), false);
    assert.match(app.alerts.at(-1), /session expired/);
});

test('send rate limit is shown and sending button is restored', async () => {
    const app = setup();
    app.auth.resetPasswordForEmail = async () => ({ error: new Error('Email rate limit exceeded') });
    app.element('forgot-email').value = 'test@example.com';
    await app.submit('forgot-password-form');
    assert.match(app.alerts[0], /rate limit/);
    assert.equal(app.element('forgot-password-form-button').disabled, false);
});
