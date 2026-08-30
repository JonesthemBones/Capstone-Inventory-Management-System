async function checkSupabaseConnection(timeout = 5000) {
    if (!window.supabaseClient) {
        return { ok: false, error: 'supabaseClient not initialized' };
    }

    const withTimeout = (p, ms) => {
        const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
        return Promise.race([p, timeout]);
    };

    try {
        const sessionRes = await withTimeout(window.supabaseClient.auth.getSession(), timeout);

        try {
            const { data, error } = await withTimeout(window.supabaseClient.from('products').select('id').limit(1), timeout);
            if (error) {
                const msg = String(error.message || error);
                if (/relation ".+" does not exist|does not exist|not found/i.test(msg)) {
                    const { data: buckets, error: bucketErr } = await withTimeout(window.supabaseClient.storage.listBuckets(), timeout);
                    if (bucketErr) {
                        return { ok: false, error: bucketErr.message || bucketErr };
                    }
                    return { ok: true, method: 'storage.buckets', bucketsCount: (buckets || []).length };
                }
                return { ok: false, error: msg };
            }
            return { ok: true, method: 'from.products', sample: Array.isArray(data) ? data[0] ?? null : null };
        } catch (innerErr) {
            return { ok: true, method: 'auth.getSession', note: 'auth reachable but table/storage check failed', detail: innerErr.message || innerErr };
        }
    } catch (err) {
        return { ok: false, error: err.message || err };
    }
}

window.supabaseCheck = {
    checkSupabaseConnection
};

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(async () => {
        try {
            const res = await checkSupabaseConnection();
            console.debug('Supabase connectivity check:', res);
        } catch (e) {
            console.debug('Supabase connectivity check failed:', e);
        }
    }, 200);
});
