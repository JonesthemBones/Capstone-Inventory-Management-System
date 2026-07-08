const SUPABASE_URL = 'https://wxhkhxsxftundtrahpst.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind4aGtoeHN4ZnR1bmR0cmFocHN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA1Nzg3NzcsImV4cCI6MjA3NjE1NDc3N30.mP2VgTOzAQSBkm1VjmBJRP08vi--pSJ3KBhdqTo5mkY';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Auth helper functions
async function checkAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    return session;
}

async function requireAuth() {
    const session = await checkAuth();
    if (!session) {
        window.location.href = '/pages/auth.html';
        return null;
    }
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

    const { error } = await supabaseClient.auth.signOut();
    if (!error) {
        window.location.href = '/pages/auth.html';
    }
    return error;
}

async function getUserRole() {
    try {
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (!user) return null;
        
        const { data: userData, error } = await supabaseClient
            .from('users')
            .select('role')
            .eq('user_id', user.id)
            .single();
        
        if (error) {
            console.error('Error fetching user role:', error);
            return null;
        }
        
        return userData?.role?.toLowerCase() || 'staff';
    } catch (error) {
        console.error('Error in getUserRole:', error);
        return null;
    }
}

async function requireRole(allowedRoles = []) {
    const session = await requireAuth();
    if (!session) return false;
    
    const userRole = await getUserRole();
    const normalizedAllowedRoles = allowedRoles.map(r => r.toLowerCase());
    
    if (!normalizedAllowedRoles.includes(userRole)) {
        alert('Access Denied: You do not have permission to access this page.');
        window.location.href = '../pages/inventory.html';
        return false;
    }
    
    return true;
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
    requireAuth,
    getCurrentUser,
    signOut,
    getUserRole,
    requireRole
};
