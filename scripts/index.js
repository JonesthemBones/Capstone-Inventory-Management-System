function redirectTo(path) {
    path = path.startsWith('/') ? path.substring(1) : path;
    window.location.href = path;
}

const MIN_LOADING_TIME = 1000;

document.addEventListener('DOMContentLoaded', async () => {
    const startTime = Date.now();

    try {
        const { data: { session }, error } = await supabase.auth.getSession();

        if (error) {
            console.error('Error checking auth status:', error.message);
            await ensureMinLoadingTime(startTime);
            redirectTo('pages/auth.html');
            return;
        }

        await ensureMinLoadingTime(startTime);

        if (session) {
            const activityKey = 'amacar:last-activity';
            const lastActivity = Number(localStorage.getItem(activityKey));
            const sessionTimedOut = Number.isFinite(lastActivity) && lastActivity > 0
                && Date.now() - lastActivity >= 5 * 60 * 1000;

            if (sessionTimedOut) {
                await supabase.rpc('release_current_session');
                await supabase.auth.signOut({ scope: 'local' });
                localStorage.removeItem(activityKey);
                redirectTo('pages/auth.html?logged_out=true&reason=inactivity');
                return;
            }
            if (!lastActivity) localStorage.setItem(activityKey, String(Date.now()));

            // Get user role for redirect
            const { data: userProfile } = await supabase
                .from('users')
                .select('role')
                .eq('user_id', session.user.id)
                .single();
            
            const redirectPage = userProfile?.role === 'cashier'
                ? 'pages/inventory.html'
                : (userProfile?.role === 'staff' ? 'pages/inventory.html' : 'pages/dashboard.html');
            redirectTo(redirectPage);
        } else {
            redirectTo('pages/auth.html');
        }
    } catch (error) {
        console.error('Error in auth check:', error);
        await ensureMinLoadingTime(startTime);
        redirectTo('pages/auth.html');
    }
});

async function ensureMinLoadingTime(startTime) {
    const elapsedTime = Date.now() - startTime;
    const remainingTime = Math.max(0, MIN_LOADING_TIME - elapsedTime);
    
    if (remainingTime > 0) {
        await new Promise(resolve => setTimeout(resolve, remainingTime));
    }
}
