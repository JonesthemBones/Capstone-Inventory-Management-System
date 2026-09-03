const SUPABASE_URL = 'https://wxhkhxsxftundtrahpst.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind4aGtoeHN4ZnR1bmR0cmFocHN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA1Nzg3NzcsImV4cCI6MjA3NjE1NDc3N30.mP2VgTOzAQSBkm1VjmBJRP08vi--pSJ3KBhdqTo5mkY';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const SESSION_CHECK_INTERVAL_MS = 10000;
let sessionReplacementInProgress = false;

// Keep open tabs consistent when a user signs out manually or times out elsewhere.
supabaseClient.auth.onAuthStateChange((event) => {
    if (event !== 'SIGNED_OUT') return;
    localStorage.removeItem('amacar:last-activity');
    const isPublicAuthPage = window.location.pathname.includes('/pages/auth.html')
        || window.location.pathname.includes('/pages/forgot-password.html');
    if (!isPublicAuthPage) {
        const reason = sessionReplacementInProgress ? '&reason=session_replaced' : '';
        window.location.replace(`/pages/auth.html?logged_out=true${reason}`);
    }
});

// Auth helper functions
async function checkAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    return session;
}

async function claimCurrentSession() {
    const { data, error } = await supabaseClient.rpc('claim_current_session');
    if (error) {
        const migrationMissing = error.code === 'PGRST202'
            || error.message?.includes('claim_current_session');
        if (migrationMissing) {
            throw new Error('Session security is not configured yet. Ask the administrator to run the single-session database migration.');
        }
        throw new Error(`Unable to register this login: ${error.message}`);
    }
    if (data !== true) {
        throw new Error('This account is already signed in on another browser. Sign out there first, or wait for the inactive session to expire.');
    }
    return true;
}

async function releaseCurrentSession() {
    const { error } = await supabaseClient.rpc('release_current_session');
    if (error) console.error('Unable to release the active-session lock:', error);
}

async function endReplacedSession() {
    if (sessionReplacementInProgress) return;
    sessionReplacementInProgress = true;
    localStorage.removeItem('amacar:last-activity');

    // Do not revoke the newer browser's session when removing this stale one.
    try {
        await supabaseClient.auth.signOut({ scope: 'local' });
    } catch (error) {
        console.error('Unable to clear replaced local session:', error);
    }

    window.location.replace('/pages/auth.html?logged_out=true&reason=session_replaced');
}

async function validateCurrentSession() {
    const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError || !session) return false;

    const { data, error } = await supabaseClient.rpc('is_current_session');
    if (error) {
        console.error('Session-lock validation failed:', error);
        return false;
    }

    if (data !== true) {
        await endReplacedSession();
        return false;
    }
    return true;
}

async function requireAuth() {
    const session = await checkAuth();
    if (!session) {
        window.location.href = '/pages/auth.html';
        return null;
    }
    if (!await validateCurrentSession()) return null;
    return session;
}

async function getCurrentUser() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    return user;
}

async function signOut() {
    try {
        const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
        if (!authError && user) {
            await logAuditEvent({
                actionType: 'logout',
                tableAffected: 'auth',
                recordId: user.id,
                oldValues: {},
                newValues: { reason: 'manual' }
            });
        }
    } catch (error) {
        console.error('Error logging logout event:', error);
    }

    await releaseCurrentSession();
    const { error } = await supabaseClient.auth.signOut({ scope: 'local' });
    if (!error) {
        localStorage.removeItem('amacar:last-activity');
        window.location.href = '/pages/auth.html';
    }
    return error;
}

async function getUserRole() {
    try {
        const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
        if (authError || !user) {
            console.warn('⚠️ Could not resolve user role from auth state:', authError?.message || 'No authenticated user');
            return 'guest';
        }

        const { data: userData, error } = await supabaseClient
            .from('users')
            .select('role')
            .eq('user_id', user.id)
            .maybeSingle();

        if (error) {
            console.warn('⚠️ Error fetching user role; falling back to staff:', error.message);
            return 'staff';
        }

        const role = (userData?.role || 'staff').toLowerCase();
        return role;
    } catch (error) {
        console.error('Error in getUserRole:', error);
        return 'guest';
    }
}

async function requireRole(allowedRoles = []) {
    const session = await requireAuth();
    if (!session) return false;
    
    const userRole = await getUserRole();
    const normalizedAllowedRoles = allowedRoles.map(r => r.toLowerCase());
    
    if (!normalizedAllowedRoles.includes(userRole)) {
        alert('Access Denied: You do not have permission to access this page.');
        window.location.href = '../pages/dashboard.html';
        return false;
    }
    
    return true;
}

function revealProtectedContent() {
    const content = document.querySelector('[data-protected-content]');
    if (!content) return;
    content.setAttribute('data-protected-ready', '');
    content.setAttribute('aria-busy', 'false');
}

// Set up sign out button listener
document.addEventListener('DOMContentLoaded', () => {
    const signOutBtn = document.querySelector('.sign-out-btn');
    if (signOutBtn) {
        signOutBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            await signOut();
        });
    }

    const isPublicPage = window.location.pathname.includes('/pages/auth.html')
        || window.location.pathname.includes('/pages/forgot-password.html');
    if (!isPublicPage) {
        validateCurrentSession();
        window.setInterval(validateCurrentSession, SESSION_CHECK_INTERVAL_MS);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') validateCurrentSession();
        });
    }
});

async function logAuditEvent({ actionType, tableAffected, recordId, oldValues = {}, newValues = {} }) {
    try {
        const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
        if (authError) {
            console.error('Unable to get current user for audit log:', authError);
            return;
        }
        if (!user) return;

        const event = {
            user_id: user.id,
            action_type: actionType,
            table_affected: tableAffected,
            record_id: recordId || user.id,
            old_values: oldValues,
            new_values: newValues,
            user_agent: navigator.userAgent,
            action_timestamp: new Date().toISOString()
        };

        const { error } = await supabaseClient
            .from('audit_logs')
            .insert([event]);

        if (error) {
            console.error('Audit log write failed:', error);
        }
    } catch (error) {
        console.error('Unexpected error writing audit log:', error);
    }
}

// Export to global scope
window.supabaseClient = supabaseClient;
window.logAuditEvent = logAuditEvent;
window.authHelpers = {
    checkAuth,
    claimCurrentSession,
    releaseCurrentSession,
    validateCurrentSession,
    requireAuth,
    getCurrentUser,
    signOut,
    getUserRole,
    requireRole,
    revealProtectedContent
};
