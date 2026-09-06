
class InactivityLogout {
    constructor(options = {}) {
        // Configuration (all times in milliseconds)
        this.inactivityTimeout = options.timeout || 10 * 60 * 1000;
        this.warningTime = options.warningTime || 10 * 1000;
        this.checkInterval = options.checkInterval || 1000; 
        
        // State
        this.activityStorageKey = 'amacar:last-activity';
        this.lastActivity = this.readLastActivity();
        this.lastActivityWrite = 0;
        this.warningShown = false;
        this.checkTimer = null;
        this.warningTimer = null;
        this.isEnabled = true;
        this.isLoggingOut = false;
        
        // Events to track for user activity
        this.activityEvents = [
            'mousedown',
            'mousemove',
            'keypress',
            'scroll',
            'touchstart',
            'click'
        ];
        
        this.init();
    }
    
    init() {
        // Only initialize on authenticated pages (not on auth.html)
        if (window.location.pathname.includes('auth.html') || 
            window.location.pathname.includes('forgot-password.html')) {
            return;
        }
        
        this.setupActivityListeners();
        this.startMonitoring();
        
        console.log(`Inactivity logout initialized: ${this.inactivityTimeout / 60000} minutes`);
    }
    
    setupActivityListeners() {
        // Bind the activity handler
        this.activityHandler = this.onActivity.bind(this);
        
        // Add event listeners for user activity
        this.activityEvents.forEach(event => {
            document.addEventListener(event, this.activityHandler, { passive: true });
        });
        
        // Listen for visibility changes
        this.visibilityHandler = () => {
            if (!document.hidden) {
                if (Date.now() - this.lastActivity >= this.inactivityTimeout) {
                    this.performLogout();
                } else {
                    this.onActivity();
                }
            }
        };
        document.addEventListener('visibilitychange', this.visibilityHandler);

        this.storageHandler = event => {
            if (event.key !== this.activityStorageKey || !event.newValue) return;
            const timestamp = Number(event.newValue);
            if (Number.isFinite(timestamp) && timestamp > this.lastActivity) {
                this.lastActivity = timestamp;
                if (this.warningShown) this.hideWarning();
            }
        };
        window.addEventListener('storage', this.storageHandler);
    }

    readLastActivity() {
        try {
            const stored = Number(localStorage.getItem('amacar:last-activity'));
            if (Number.isFinite(stored) && stored > 0) return stored;
            const now = Date.now();
            localStorage.setItem('amacar:last-activity', String(now));
            return now;
        } catch (error) {
            return Date.now();
        }
    }
    
    onActivity() {
        if (!this.isEnabled) return;
        
        this.lastActivity = Date.now();
        if (this.lastActivity - this.lastActivityWrite >= 1000) {
            try {
                localStorage.setItem(this.activityStorageKey, String(this.lastActivity));
                this.lastActivityWrite = this.lastActivity;
            } catch (error) {
                // Continue with this tab's in-memory timer if storage is unavailable.
            }
        }
        
        // Reset warning if user becomes active again
        if (this.warningShown) {
            this.hideWarning();
            this.warningShown = false;
        }
    }
    
    startMonitoring() {
        // Clear any existing timers
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
        }
        
        // Check inactivity periodically
        this.checkTimer = setInterval(() => {
            this.checkInactivity();
        }, this.checkInterval);
    }
    
    checkInactivity() {
        if (!this.isEnabled) return;
        
        const now = Date.now();
        const inactiveTime = now - this.lastActivity;
        const timeUntilLogout = this.inactivityTimeout - inactiveTime;
        
        // Show warning if approaching timeout
        if (timeUntilLogout <= this.warningTime && !this.warningShown) {
            this.showWarning(Math.ceil(timeUntilLogout / 1000));
            this.warningShown = true;
        }
        
        // Logout if timeout reached
        if (inactiveTime >= this.inactivityTimeout) {
            this.performLogout();
        }
    }
    
    showWarning(secondsRemaining) {
        const minutes = Math.floor(secondsRemaining / 60);
        const seconds = secondsRemaining % 60;
        
        // Create warning modal
        const modal = document.createElement('div');
        modal.id = 'inactivity-warning-modal';
        modal.className = 'inactivity-modal';
        modal.innerHTML = `
            <div class="inactivity-modal-content" role="dialog" aria-labelledby="inactivity-title" aria-describedby="inactivity-description">
                <div class="inactivity-modal-header">
                    <span class="inactivity-eyebrow">AMACAR HARDWARE <span aria-hidden="true">/</span> SESSION</span>
                    <h3 id="inactivity-title">Still working?</h3>
                </div>
                <div class="inactivity-modal-body">
                    <p id="inactivity-description">Your session will end soon because there hasn't been any activity.</p>
                    <div class="inactivity-countdown" id="inactivity-countdown" role="timer" aria-label="Time until automatic sign out">
                        <span class="inactivity-countdown-label"><i class="far fa-clock" aria-hidden="true"></i> Signing out in</span>
                        <span class="countdown-time">${minutes}:${seconds.toString().padStart(2, '0')}</span>
                    </div>
                    <p class="inactivity-hint">Moving your mouse or typing also keeps you signed in.</p>
                </div>
                <div class="inactivity-modal-footer">
                    <button type="button" class="btn btn-secondary" id="logout-now-btn">Sign out</button>
                    <button type="button" class="btn btn-primary" id="stay-logged-in-btn">Stay signed in</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Add styles if not already present
        this.injectStyles();
        
        // Update countdown
        this.warningTimer = setInterval(() => {
            const now = Date.now();
            const remaining = Math.max(0, this.inactivityTimeout - (now - this.lastActivity));
            const secs = Math.ceil(remaining / 1000);
            const mins = Math.floor(secs / 60);
            const remainingSecs = secs % 60;
            
            const countdownEl = document.getElementById('inactivity-countdown');
            if (countdownEl) {
                countdownEl.querySelector('.countdown-time').textContent = 
                    `${mins}:${remainingSecs.toString().padStart(2, '0')}`;
            }
            
            if (remaining <= 0) {
                clearInterval(this.warningTimer);
            }
        }, 1000);
        
        // Button handlers
        document.getElementById('stay-logged-in-btn')?.addEventListener('click', () => {
            this.onActivity();
            this.hideWarning();
        });
        
        document.getElementById('logout-now-btn')?.addEventListener('click', () => {
            this.performLogout();
        });
        
        // Show with animation
        setTimeout(() => modal.classList.add('show'), 10);
    }
    
    hideWarning() {
        const modal = document.getElementById('inactivity-warning-modal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(() => modal.remove(), 300);
        }
        
        if (this.warningTimer) {
            clearInterval(this.warningTimer);
            this.warningTimer = null;
        }
        
        this.warningShown = false;
    }
    
    async performLogout() {
        if (this.isLoggingOut) return;
        this.isLoggingOut = true;
        window.__amacarLogoutReason = 'inactivity';
        console.log('Performing automatic logout due to inactivity...');
        
        // Clean up
        this.cleanup();
        
        // Do not let a slow audit/RPC request keep an expired session open.
        const withDeadline = (promise, milliseconds, label) => Promise.race([
            Promise.resolve(promise),
            new Promise((_, reject) => setTimeout(
                () => reject(new Error(`${label} timed out`)),
                milliseconds
            ))
        ]);

        // Sign out using Supabase. Audit and lock release are best-effort; local
        // sign-out and navigation must still happen when the network is down.
        try {
            if (window.supabaseClient) {
                try {
                    const { data: { user }, error: userError } = await withDeadline(
                        window.supabaseClient.auth.getUser(), 1500, 'User lookup'
                    );
                    if (!userError && user) {
                        await withDeadline(window.logAuditEvent({
                            actionType: 'logout',
                            tableAffected: 'auth',
                            recordId: user.id,
                            oldValues: {},
                            newValues: { reason: 'inactivity' }
                        }), 1500, 'Logout audit');
                    }
                } catch (logError) {
                    console.error('Error logging inactivity logout audit event:', logError);
                }
                try {
                    await withDeadline(
                        window.authHelpers?.releaseCurrentSession?.(), 1500, 'Session release'
                    );
                } catch (releaseError) {
                    console.error('Error releasing inactive session:', releaseError);
                }
                await withDeadline(
                    window.supabaseClient.auth.signOut({ scope: 'local' }), 2000, 'Local sign out'
                );
            }
        } catch (error) {
            console.error('Error signing out:', error);
        } finally {
            // Supabase normally removes this during signOut. Remove it directly as
            // a fallback so auth.html cannot restore an expired local session.
            const authStorageKey = window.supabaseClient?.auth?.storageKey;
            if (authStorageKey) {
                try { localStorage.removeItem(authStorageKey); } catch (_) { /* Storage is optional. */ }
            }
        }
        try {
            localStorage.removeItem(this.activityStorageKey);
        } catch (error) {
            // Redirect even if browser storage is unavailable.
        }
        
        // Redirect to auth page with message
        window.location.replace('/pages/auth.html?logged_out=true&reason=inactivity');
    }
    
    injectStyles() {
        if (document.getElementById('inactivity-logout-styles')) return;
        
        const styles = document.createElement('style');
        styles.id = 'inactivity-logout-styles';
        styles.textContent = `
            .inactivity-modal {
                position: fixed;
                inset: 0;
                padding: 20px;
                box-sizing: border-box;
                background: rgba(7, 15, 26, 0.48);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
                opacity: 0;
                transition: opacity 0.18s ease;
            }
            .inactivity-modal.show { opacity: 1; }
            .inactivity-modal-content {
                text-align: center;
                width: 100%;
                max-width: 420px;
                max-height: calc(100dvh - 40px);
                overflow: auto;
                background: var(--bg-primary, #ffffff);
                color: var(--text-primary, #172033);
                border: 1px solid var(--border-color, #dce2e9);
                border-radius: 10px;
                box-shadow: 0 16px 48px rgba(0, 0, 0, 0.2);
                transform: translateY(8px);
                transition: transform 0.18s ease;
            }
            .inactivity-modal.show .inactivity-modal-content { transform: translateY(0); }
            .inactivity-modal-header { padding: 26px 26px 0; }
            .inactivity-eyebrow {
                display: block;
                color: var(--text-secondary, #64748b);
                font-size: 10px;
                font-weight: 600;
                letter-spacing: 0.1em;
            }
            .inactivity-eyebrow span { margin: 0 6px; opacity: 0.5; }
            .inactivity-modal-header h3 {
                margin: 14px 0 0;
                font-size: 23px;
                line-height: 1.3;
                font-weight: 600;
                letter-spacing: -0.025em;
            }
            .inactivity-modal-body { padding: 10px 26px 22px; }
            .inactivity-modal-body p {
                margin: 0;
                color: var(--text-secondary, #64748b);
                font-size: 14px;
                line-height: 1.65;
            }
            .inactivity-countdown {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 10px;
                margin: 20px 0 12px;
                padding: 14px 16px;
                background: var(--bg-secondary, #f5f7fa);
                border: 1px solid var(--border-color, #dce2e9);
                border-radius: 6px;
            }
            .inactivity-countdown-label {
                display: flex;
                align-items: center;
                gap: 9px;
                font-size: 13px;
            }
            .inactivity-countdown-label i { color: var(--text-secondary, #64748b); }
            .inactivity-countdown .countdown-time {
                font-family: inherit;
                font-variant-numeric: tabular-nums;
                font-size: 26px;
                font-weight: 600;
                line-height: 1;
                letter-spacing: -0.03em;
                color: var(--text-primary, #172033);
            }
            .inactivity-modal-body .inactivity-hint { font-size: 12px; }
            .inactivity-modal-footer {
                padding: 16px 26px;
                border-top: 1px solid var(--border-color, #dce2e9);
                display: flex;
                justify-content: center;
                gap: 10px;
            }
            .inactivity-modal-footer .btn {
                min-height: 42px;
                padding: 10px 16px;
                border: 1px solid transparent;
                border-radius: 6px;
                font: inherit;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
            }
            .inactivity-modal-footer .btn-primary { background: #2563eb; color: #ffffff; }
            .inactivity-modal-footer .btn-primary:hover { background: #1d4ed8; }
            .inactivity-modal-footer .btn-secondary {
                background: transparent;
                border-color: var(--border-color, #dce2e9);
                color: var(--text-primary, #172033);
            }
            .inactivity-modal-footer .btn-secondary:hover { background: var(--bg-secondary, #f5f7fa); }
            .inactivity-modal-footer .btn:focus-visible { outline: 2px solid #60a5fa; outline-offset: 3px; }
            @media (max-width: 380px) {
                .inactivity-modal-header { padding: 22px 20px 0; }
                .inactivity-modal-body { padding: 10px 20px 20px; }
                .inactivity-modal-footer { padding: 14px 20px; }
                .inactivity-modal-footer .btn { flex: 1; padding: 10px; }
            }
            @media (prefers-reduced-motion: reduce) {
                .inactivity-modal, .inactivity-modal-content { transition: none; transform: none; }
            }
        `;

        document.head.appendChild(styles);
    }
    
    cleanup() {
        // Remove event listeners
        this.activityEvents.forEach(event => {
            document.removeEventListener(event, this.activityHandler);
        });
        document.removeEventListener('visibilitychange', this.visibilityHandler);
        window.removeEventListener('storage', this.storageHandler);
        
        // Clear timers
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
        }
        if (this.warningTimer) {
            clearInterval(this.warningTimer);
        }
        
        this.isEnabled = false;
    }
    
    // Public methods to control the system
    disable() {
        this.isEnabled = false;
        this.hideWarning();
    }
    
    enable() {
        this.isEnabled = true;
        this.lastActivity = Date.now();
    }
    
    reset() {
        this.lastActivity = Date.now();
        this.hideWarning();
    }
    
    setTimeout(minutes) {
        this.inactivityTimeout = minutes * 60 * 1000;
        this.reset();
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {    
    window.inactivityLogout = new InactivityLogout({
        timeout: 10 * 60 * 1000, // Sign out after 10 minutes of inactivity.
        warningTime: 10 * 1000,
        checkInterval: 1000             
    });
});

// Export for global access
window.InactivityLogout = InactivityLogout;
