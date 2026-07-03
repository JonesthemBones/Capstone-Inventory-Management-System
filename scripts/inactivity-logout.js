
class InactivityLogout {
    constructor(options = {}) {
        // Configuration (all times in milliseconds)
        this.inactivityTimeout = options.timeout || 15 * 60 * 1000;
        this.warningTime = options.warningTime || 2 * 60 * 1000; 
        this.checkInterval = options.checkInterval || 1000; 
        
        // State
        this.lastActivity = Date.now();
        this.warningShown = false;
        this.checkTimer = null;
        this.warningTimer = null;
        this.isEnabled = true;
        
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
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.onActivity();
            }
        });
    }
    
    onActivity() {
        if (!this.isEnabled) return;
        
        this.lastActivity = Date.now();
        
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
            <div class="inactivity-modal-content">
                <div class="inactivity-modal-header">
                    <i class="fas fa-clock"></i>
                    <h3>Session Timeout Warning</h3>
                </div>
                <div class="inactivity-modal-body">
                    <p>You've been inactive for a while.</p>
                    <p>You will be automatically logged out in:</p>
                    <div class="inactivity-countdown" id="inactivity-countdown">
                        <span class="countdown-time">${minutes}:${seconds.toString().padStart(2, '0')}</span>
                    </div>
                    <p class="inactivity-hint">Move your mouse or press any key to stay logged in.</p>
                </div>
                <div class="inactivity-modal-footer">
                    <button class="btn btn-primary" id="stay-logged-in-btn">
                        <i class="fas fa-check"></i> Stay Logged In
                    </button>
                    <button class="btn btn-secondary" id="logout-now-btn">
                        <i class="fas fa-sign-out-alt"></i> Logout Now
                    </button>
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
        console.log('Performing automatic logout due to inactivity...');
        
        // Clean up
        this.cleanup();
        
        // Sign out using Supabase
        try {
            if (window.supabaseClient) {
                await window.supabaseClient.auth.signOut();
            }
        } catch (error) {
            console.error('Error signing out:', error);
        }
        
        // Redirect to auth page with message
        window.location.href = '/pages/auth.html?logged_out=true&reason=inactivity';
    }
    
    injectStyles() {
        if (document.getElementById('inactivity-logout-styles')) return;
        
        const styles = document.createElement('style');
        styles.id = 'inactivity-logout-styles';
        styles.textContent = `
            .inactivity-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.7);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
                opacity: 0;
                transition: opacity 0.3s ease;
            }
            
            .inactivity-modal.show {
                opacity: 1;
            }
            
            .inactivity-modal-content {
                background: var(--bg-primary, #ffffff);
                border-radius: 12px;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
                max-width: 450px;
                width: 90%;
                overflow: hidden;
                transform: scale(0.9);
                transition: transform 0.3s ease;
            }
            
            .inactivity-modal.show .inactivity-modal-content {
                transform: scale(1);
            }
            
            .inactivity-modal-header {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 24px;
                text-align: center;
            }
            
            .inactivity-modal-header i {
                font-size: 48px;
                margin-bottom: 12px;
                animation: pulse 2s infinite;
            }
            
            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.6; }
            }
            
            .inactivity-modal-header h3 {
                margin: 0;
                font-size: 22px;
                font-weight: 600;
            }
            
            .inactivity-modal-body {
                padding: 32px 24px;
                text-align: center;
                color: var(--text-primary, #333);
            }
            
            .inactivity-modal-body p {
                margin: 8px 0;
                font-size: 15px;
            }
            
            .inactivity-countdown {
                margin: 24px 0;
                padding: 20px;
                background: var(--bg-secondary, #f5f5f5);
                border-radius: 8px;
            }
            
            .countdown-time {
                font-size: 48px;
                font-weight: bold;
                color: #dc2626;
                font-family: 'Courier New', monospace;
            }
            
            .inactivity-hint {
                font-size: 13px;
                color: var(--text-secondary, #666);
                margin-top: 16px;
                font-style: italic;
            }
            
            .inactivity-modal-footer {
                padding: 20px 24px;
                background: var(--bg-secondary, #f9fafb);
                display: flex;
                gap: 12px;
                justify-content: center;
            }
            
            .inactivity-modal-footer .btn {
                padding: 12px 24px;
                border: none;
                border-radius: 8px;
                font-size: 15px;
                font-weight: 500;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
                transition: all 0.2s;
            }
            
            .inactivity-modal-footer .btn-primary {
                background: #2563eb;
                color: white;
            }
            
            .inactivity-modal-footer .btn-primary:hover {
                background: #1d4ed8;
                transform: translateY(-1px);
            }
            
            .inactivity-modal-footer .btn-secondary {
                background: #6b7280;
                color: white;
            }
            
            .inactivity-modal-footer .btn-secondary:hover {
                background: #4b5563;
                transform: translateY(-1px);
            }
        `;
        
        document.head.appendChild(styles);
    }
    
    cleanup() {
        // Remove event listeners
        this.activityEvents.forEach(event => {
            document.removeEventListener(event, this.activityHandler);
        });
        
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
        timeout: 15 * 60 * 1000,       
        warningTime: 2 * 60 * 1000,
        checkInterval: 1000             
    });
});

// Export for global access
window.InactivityLogout = InactivityLogout;
