// Increment whenever shared sidebar markup changes so stale cached branding
// and navigation are not restored after the loading skeleton disappears.
const SIDEBAR_CACHE_VERSION = 'v4';

const sidebarConfig = [
    {
        id: 'dashboard',
        title: 'Dashboard',
        icon: 'fas fa-tachometer-alt',
        path: 'pages/dashboard.html',
        permission: ['admin', 'manager', 'cashier', 'staff']
    },
    {
        id: 'inventory',
        title: 'Inventory',
        icon: 'fas fa-box',
        path: 'pages/inventory.html',
        permission: ['admin', 'manager', 'cashier', 'staff']
    },
    {
        id: 'pos',
        title: 'Point of Sale',
        icon: 'fas fa-cash-register',
        path: 'pages/pos.html',
        permission: ['admin', 'manager', 'cashier']
    },
    {
        id: 'reports',
        title: 'Reports',
        icon: 'fas fa-file-alt',
        path: 'pages/reports.html',
        permission: ['admin', 'manager', 'cashier', 'staff']
    },
    {
        id: 'users',
        title: 'User Management',
        icon: 'fas fa-users',
        path: 'pages/users.html',
        permission: ['admin']
    },
    {
        id: 'audit-logs',
        title: 'Audit Logs',
        icon: 'fas fa-clipboard-list',
        path: 'pages/audit_logs.html',
        permission: ['admin']
    }
];

async function waitForDependencies() {
    const timeout = 5000; // 5 seconds max wait
    const startTime = Date.now();
    
    // Poll for supabaseClient but do not block the sidebar from rendering
    while (!window.supabaseClient && (Date.now() - startTime < timeout)) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    if (!window.supabaseClient) {
        console.warn('⚠️ Supabase client not ready yet; rendering sidebar without role-based filtering.');
        return false;
    }
    
    console.log('✅ Supabase client ready');
    return true;
}

function getSidebarFetchCandidates() {
    const candidates = [
        '../components/sidebar.html',
        './components/sidebar.html',
        '../../components/sidebar.html',
        '/components/sidebar.html',
        `${window.location.origin}/components/sidebar.html`
    ];

    return [...new Set(candidates.map(candidate => candidate.toString()))];
}

function getSidebarCacheKey(userRole = 'guest') {
    return `inventory-sidebar:${SIDEBAR_CACHE_VERSION}:${(userRole || 'guest').toLowerCase()}`;
}

function getCachedSidebarMarkup(userRole) {
    try {
        const storageKey = getSidebarCacheKey(userRole);
        const cachedValue = sessionStorage.getItem(storageKey) || localStorage.getItem(storageKey);
        return cachedValue || null;
    } catch (error) {
        console.warn('⚠️  Could not read cached sidebar markup:', error.message);
        return null;
    }
}

// Neutral placeholder shown ONLY while the real role is being determined.
// Deliberately contains no nav links at all, so no role's navigation — not
// even the current user's own — can ever flash before permissions are known.
function buildLoadingSkeletonHTML() {
    return `
        <header class="mobile-header">
            <div class="mobile-header-content">
                <div class="mobile-logo">
                    <img class="mobile-brand-logo" src="../styles/img/AmacarLogo.png" alt="Amacar Enterprise logo">
                    <span>Amacar Hardware Inventory System</span>
                </div>
                <button class="mobile-menu-toggle" id="mobile-menu-toggle" aria-label="Toggle menu">
                    <i class="fas fa-bars"></i>
                </button>
            </div>
        </header>
        <aside class="sidebar">
            <div class="sidebar-header">
                <div class="logo">
                    <img class="sidebar-brand-logo" src="../styles/img/AmacarLogo.png" alt="Amacar Enterprise logo">
                    <div class="logo-text">
                        <h2><span>Amacar Hardware</span><span>Inventory System</span></h2>
                    </div>
                </div>
            </div>
            <div class="sidebar-section">
                <div class="section-title">Navigation</div>
                <div class="nav-loading" style="padding: 12px; color: #6b7280; font-size: 0.9rem;">
                    <i class="fas fa-spinner fa-spin"></i> Loading menu...
                </div>
            </div>
            <div class="sidebar-footer">
                <div class="user-info-section">
                    <p class="user-label">User</p>
                    <p class="user-name">Loading...</p>
                    <p class="user-role"></p>
                </div>
            </div>
        </aside>`;
}

// Last-resort fallback if sidebar.html can't be fetched/parsed at all. Kept
// permission-free (no page links) for the same reason as the skeleton above —
// we should never render nav items we haven't role-filtered.
function buildFallbackSidebarHTML() {
    return `
        <header class="mobile-header">
            <div class="mobile-header-content">
                <div class="mobile-logo">
                    <img class="mobile-brand-logo" src="../styles/img/AmacarLogo.png" alt="Amacar Enterprise logo">
                    <span>Amacar Hardware Inventory System</span>
                </div>
                <button class="mobile-menu-toggle" id="mobile-menu-toggle" aria-label="Toggle menu">
                    <i class="fas fa-bars"></i>
                </button>
            </div>
            <nav class="mobile-nav-dropdown" id="mobile-nav-dropdown">
                <div class="mobile-nav-section">
                    <div class="mobile-section-title">Navigation</div>
                    <div class="nav-loading" style="padding: 12px; color: #6b7280; font-size: 0.9rem;">
                        Menu unavailable — please reload the page.
                    </div>
                </div>
                <div class="mobile-nav-footer">
                    <div class="mobile-user-info">
                        <p class="mobile-user-label">User</p>
                        <p class="mobile-user-name">Loading...</p>
                        <p class="mobile-user-role"></p>
                    </div>
                    <a href="#" class="mobile-sign-out-btn">
                        <i class="fas fa-sign-out-alt"></i>
                        <span>Sign Out</span>
                    </a>
                </div>
            </nav>
        </header>
        <aside class="sidebar">
            <div class="sidebar-header">
                <div class="logo">
                    <img class="sidebar-brand-logo" src="../styles/img/AmacarLogo.png" alt="Amacar Enterprise logo">
                    <div class="logo-text">
                        <h2><span>Amacar Hardware</span><span>Inventory System</span></h2>
                    </div>
                </div>
            </div>
            <div class="sidebar-section">
                <div class="section-title">Navigation</div>
                <div class="nav-loading" style="padding: 12px; color: #6b7280; font-size: 0.9rem;">
                    Menu unavailable — please reload the page.
                </div>
            </div>
            <div class="sidebar-footer">
                <div class="user-info-section">
                    <p class="user-label">User</p>
                    <p class="user-name">Loading...</p>
                    <p class="user-role"></p>
                </div>
                <a href="#" class="sign-out-btn">
                    <i class="fas fa-sign-out-alt"></i>
                    <span>Sign Out</span>
                </a>
            </div>
        </aside>`;
}

function saveCachedSidebarMarkup(markup, userRole) {
    try {
        const storageKey = getSidebarCacheKey(userRole);
        sessionStorage.setItem(storageKey, markup);
        localStorage.setItem(storageKey, markup);
    } catch (error) {
        console.warn('⚠️  Could not cache sidebar markup:', error.message);
    }
}

async function fetchSidebarHTML() {
    const possiblePaths = getSidebarFetchCandidates();
    
    console.log(`🔍 Searching for sidebar.html...`);
    
    for (const path of possiblePaths) {
        try {
            const response = await fetch(path);
            if (response.ok) {
                const html = await response.text();
                if (html && html.includes('sidebar')) {
                    console.log(`✅ Sidebar found at: ${path}`);
                    return html;
                }
            }
        } catch (error) {
            console.debug(`   Not found at ${path}`);
        }
    }
    
    const errorMsg = `Sidebar HTML not found at any of these paths:\n${possiblePaths.join('\n')}`;
    throw new Error(errorMsg);
}


async function getUserRole() {
    if (!window.supabaseClient) {
        console.warn('⚠️  Supabase not available, using guest role');
        return 'guest';
    }
    
    try {
        const { data: { user }, error: authError } = await window.supabaseClient.auth.getUser();
        
        if (authError) {
            console.warn('⚠️  Auth error:', authError.message);
            return 'guest';
        }
        
        if (!user) {
            console.warn('⚠️  No user authenticated');
            return 'guest';
        }

        const { data: userData, error: dbError } = await window.supabaseClient
            .from('users')
            .select('role')
            .eq('user_id', user.id)
            .maybeSingle();

        if (dbError) {
            console.warn('⚠️  Could not fetch user role:', dbError.message);
            return 'staff';
        }
        
        const role = (userData?.role || 'staff').toLowerCase();
        console.log(`✅ User role: ${role}`);
        return role;

    } catch (error) {
        console.error('❌ Error in getUserRole():', error);
        return 'guest';
    }
}


function filterSidebarByRole(sidebarHTML, userRole) {
    try {
        const normalizedRole = (userRole || 'guest').toLowerCase();

        if (!window.supabaseClient || normalizedRole === 'guest') {
            console.log('ℹ️ Skipping role filtering for guest or unauthenticated state');
            return sidebarHTML;
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(sidebarHTML, 'text/html');
        
        // Find all permission-gated items
        const permissionedItems = doc.querySelectorAll('[data-permission]');
        console.log(`📋 Found ${permissionedItems.length} permission-gated items`);
        
        let removedCount = 0;
        permissionedItems.forEach(item => {
            const permissionAttr = item.getAttribute('data-permission');
            if (!permissionAttr) return;
            
            const allowedRoles = permissionAttr.split(',').map(r => r.trim().toLowerCase());
            const isAllowed = allowedRoles.includes(normalizedRole);
            
            if (!isAllowed) {
                const itemText = item.textContent?.trim().substring(0, 30) || 'unknown';
                console.log(`   Removing: ${itemText} (requires: ${allowedRoles.join(', ')})`);
                item.remove();
                removedCount++;
            }
        });
        
        console.log(`✅ Filtered: Removed ${removedCount} items for role ${normalizedRole}`);
        
        // Remove empty sections
        const sections = doc.querySelectorAll('.sidebar-section, .mobile-nav-section');
        let emptyCount = 0;
        sections.forEach(section => {
            const items = section.querySelectorAll('.nav-item, .mobile-nav-item, [data-permission]');
            if (items.length === 0) {
                section.remove();
                emptyCount++;
            }
        });
        
        if (emptyCount > 0) {
            console.log(`✅ Removed ${emptyCount} empty sections`);
        }
        
        return doc.body.innerHTML;
        
    } catch (error) {
        console.error('❌ Error filtering sidebar:', error);
        throw error;
    }
}


function insertSidebarIntoDOM(sidebarContent) {
    // Verify app-container exists
    const appContainer = document.querySelector('.app-container');
    if (!appContainer) {
        throw new Error(`
            ❌ CRITICAL: .app-container not found in page DOM
            
            Make sure your HTML has:
            <div class="app-container">
                <main class="main-content">...
        `);
    }
    
    try {
        const resolvedSidebarContent = (sidebarContent || '').trim() || buildFallbackSidebarHTML();

        // Remove any existing sidebars first
        document.querySelector('.sidebar')?.remove();
        document.querySelector('.mobile-header')?.remove();
        
        // Insert new sidebar
        appContainer.insertAdjacentHTML('afterbegin', resolvedSidebarContent);
        console.log('✅ Sidebar HTML inserted into DOM');
        
        // Verify insertion was successful
        if (!document.querySelector('.sidebar') && !document.querySelector('.mobile-header')) {
            throw new Error('Sidebar HTML was parsed but not found in DOM after insertion');
        }
        
    } catch (error) {
        console.error('❌ Error inserting sidebar:', error);
        throw error;
    }
}

function markCurrentPageActive() {
    const currentPageName = window.location.pathname.split('/').pop() || 'dashboard.html';
    const navItems = document.querySelectorAll('.nav-item, .mobile-nav-item');
    
    let found = false;
    navItems.forEach(item => {
        const href = item.getAttribute('href');
        if (href && href.includes(currentPageName)) {
            item.classList.add('active');
            console.log(`✅ Marked active: ${currentPageName}`);
            found = true;
        } else {
            item.classList.remove('active');
        }
    });
    
    if (!found) {
        console.warn(`⚠️  Could not match current page: ${currentPageName}`);
    }
}

async function loadUserInfo() {
    try {
        const supabase = window.supabaseClient;
        if (!supabase) {
            updateUserDisplay(null, 'Guest');
            return;
        }

        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            updateUserDisplay(null, 'Guest');
            return;
        }

        const { data: userData, error: profileError } = await supabase
            .from('users')
            .select('first_name, last_name, email, role')
            .eq('user_id', user.id)
            .maybeSingle();

        const profile = userData || {
            first_name: '',
            last_name: '',
            email: user.email || 'User',
            role: 'staff'
        };

        if (profileError) {
            console.warn('⚠️  Could not load user profile, using auth fallback:', profileError.message);
        }

        updateUserDisplay(profile, user.email || 'User');

    } catch (error) {
        console.warn('⚠️  Could not load user info:', error.message);
        updateUserDisplay(null, 'Guest');
    }
}

function updateUserDisplay(userData, fallbackEmail) {
    const safeUser = userData || {};
    const fullName = [safeUser.first_name, safeUser.last_name].filter(Boolean).join(' ').trim();
    const displayName = fullName || (safeUser.email || fallbackEmail || 'Guest');
    const displayRole = safeUser.role
        ? safeUser.role.charAt(0).toUpperCase() + safeUser.role.slice(1)
        : 'User';

    document.querySelectorAll('.user-name, .mobile-user-name').forEach(el => {
        if (el) el.textContent = displayName;
    });

    document.querySelectorAll('.user-role, .mobile-user-role').forEach(el => {
        if (el) el.textContent = displayRole;
    });
}


async function checkLowStockItems() {
    try {
        const { data: lowStockItems } = await window.supabaseClient
            .from('inventory_stock')
            .select('quantity, product:products(reorder_level, maximum_stock, is_active)');
        return (lowStockItems || []).some(item => {
            if (item.product?.is_active === false) return false;
            const quantity = Number(item.quantity || 0);
            const maximumStock = Number(item.product?.maximum_stock || 0);
            const lowThreshold = maximumStock > 0
                ? Math.ceil(maximumStock * 0.25)
                : Number(item.product?.reorder_level || 0);
            return quantity > 0 && lowThreshold > 0 && quantity <= lowThreshold;
        });
    } catch (error) {
        console.warn('⚠️  Error checking low stock:', error.message);
        return false;
    }
}

async function checkOutOfStockItems() {
    try {
        const { data: outOfStockItems } = await window.supabaseClient
            .from('inventory_stock')
            .select('quantity, product:products(is_active)')
            .lte('quantity', 0);
        return (outOfStockItems || []).some(item => item.product?.is_active !== false);
    } catch (error) {
        console.warn('⚠️  Error checking out of stock:', error.message);
        return false;
    }
}

async function updateLowStockIndicator() {
    try {
        const hasLowStock = await checkLowStockItems();
        const hasOutOfStock = await checkOutOfStockItems();
        const dashboardLink = document.querySelector('a[href*="dashboard.html"]');
        const indicatorDot = dashboardLink?.querySelector('.indicator-dot');

        if (!indicatorDot) return;

        if (hasOutOfStock) {
            indicatorDot.style.display = 'block';
            indicatorDot.classList.add('flashing');
            indicatorDot.classList.remove('low-stock');
            console.log('⚠️  Out of stock items detected - showing alert');
        } else if (hasLowStock) {
            indicatorDot.style.display = 'block';
            indicatorDot.classList.add('low-stock');
            indicatorDot.classList.remove('flashing');
            console.log('🟡 Low stock items detected');
        } else {
            indicatorDot.style.display = 'none';
            indicatorDot.classList.remove('low-stock', 'flashing');
        }
    } catch (error) {
        console.warn('⚠️  Error updating indicator:', error.message);
    }
}


function setupMobileMenu() {
    const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
    const mobileNavDropdown = document.getElementById('mobile-nav-dropdown');
    
    if (!mobileMenuToggle || !mobileNavDropdown) {
        console.debug('Mobile menu elements not found (probably desktop view)');
        return;
    }

    const setMenuOpen = (isOpen) => {
        mobileNavDropdown.classList.toggle('open', isOpen);
        mobileMenuToggle.setAttribute('aria-expanded', String(isOpen));
        mobileMenuToggle.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
        mobileNavDropdown.setAttribute('aria-hidden', String(!isOpen));
        document.body.classList.toggle('mobile-nav-open', isOpen);

        const icon = mobileMenuToggle.querySelector('i');
        icon?.classList.toggle('fa-bars', !isOpen);
        icon?.classList.toggle('fa-times', isOpen);
    };

    mobileMenuToggle.setAttribute('aria-controls', mobileNavDropdown.id);
    setMenuOpen(false);

    // Toggle menu open/close
    mobileMenuToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        setMenuOpen(!mobileNavDropdown.classList.contains('open'));
    });

    // Close menu when item is clicked
    document.querySelectorAll('.mobile-nav-item').forEach(item => {
        item.addEventListener('click', () => {
            setMenuOpen(false);
        });
    });

    // Close menu when clicking outside
    document.addEventListener('click', (event) => {
        const isClickInside = mobileNavDropdown.contains(event.target) || 
                            mobileMenuToggle.contains(event.target);
        
        if (!isClickInside && mobileNavDropdown.classList.contains('open')) {
            setMenuOpen(false);
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && mobileNavDropdown.classList.contains('open')) {
            setMenuOpen(false);
            mobileMenuToggle.focus();
        }
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > 768 && mobileNavDropdown.classList.contains('open')) {
            setMenuOpen(false);
        }
    });
}

function setupSignOutButtons() {
    const signOutBtns = document.querySelectorAll('.sign-out-btn, .mobile-sign-out-btn');
    
    signOutBtns.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            
            if (!confirm('Are you sure you want to sign out?')) {
                return;
            }
            
            try {
                const originalHTML = btn.innerHTML;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>Signing out...</span>';
                btn.style.pointerEvents = 'none';
                
                try {
                    const { data: { user }, error: userError } = await window.supabaseClient.auth.getUser();
                    if (!userError && user) {
                        await window.logAuditEvent({
                            actionType: 'logout',
                            tableAffected: 'auth',
                            recordId: user.id,
                            oldValues: {},
                            newValues: { reason: 'manual' }
                        });
                    }
                } catch (logError) {
                    console.error('Error logging logout audit event:', logError);
                }

                const { error } = await window.supabaseClient.auth.signOut();
                if (error) throw error;
                
                if (window.utils?.showToast) {
                    window.utils.showToast('Signed out successfully', 'success');
                }
                
                setTimeout(() => {
                    window.location.href = '../pages/auth.html?logged_out=true';
                }, 500);
                
            } catch (error) {
                console.error('❌ Sign out error:', error);
                btn.innerHTML = '<i class="fas fa-sign-out-alt"></i><span>Sign Out</span>';
                btn.style.pointerEvents = 'auto';
                
                if (window.utils?.showToast) {
                    window.utils.showToast('Error signing out: ' + error.message, 'error');
                } else {
                    alert('Error signing out: ' + error.message);
                }
            }
        });
    });
}

function syncUserInfo() {
    const desktopName = document.querySelector('.sidebar .user-name');
    const desktopRole = document.querySelector('.sidebar .user-role');
    const mobileName = document.querySelector('.mobile-user-name');
    const mobileRole = document.querySelector('.mobile-user-role');

    if (desktopName && mobileName) {
        mobileName.textContent = desktopName.textContent;
    }
    if (desktopRole && mobileRole) {
        mobileRole.textContent = desktopRole.textContent;
    }
}

function showSidebarError(message) {
    // Log to console
    console.error('🔴 SIDEBAR ERROR:', message);
    
    // Show banner to user
    const errorBanner = document.createElement('div');
    errorBanner.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: #fee8e8;
        color: #c33;
        padding: 16px;
        font-weight: bold;
        z-index: 10000;
        border-bottom: 3px solid #c33;
        font-family: monospace;
        font-size: 13px;
    `;
    errorBanner.innerHTML = `
        ❌ <strong>Sidebar Failed to Load</strong><br>
        ${message.substring(0, 200)}<br>
        <small>Check browser console (F12) for details</small>
    `;
    document.body.insertBefore(errorBanner, document.body.firstChild);
}


async function loadSidebar() {
    console.log('=====================================');
    console.log('🚀 SIDEBAR INITIALIZATION STARTED');
    console.log('=====================================');
    
    try {
        // Render a neutral placeholder with NO nav links until we know the
        // real logged-in user's role. We intentionally do not guess based on
        // whatever role happens to be cached in this browser — a stale
        // 'admin' cache from a previous login must never be shown to a
        // different, lower-privileged user.
        console.log('📦 Rendering neutral loading skeleton first');
        insertSidebarIntoDOM(buildLoadingSkeletonHTML());

        // Step 1: Wait briefly for dependencies, but do not block sidebar rendering
        console.log('\n[1/8] ⏳ Waiting for dependencies...');
        const isSupabaseReady = await waitForDependencies();
        
        // Step 2: Get user role first so we can reuse cached markup across refreshes
        console.log('\n[2/8] 👤 Getting user role...');
        const userRole = await getUserRole();
        window.currentUserRole = userRole;

        // Step 3: Use cached filtered markup when available, otherwise fetch and render it
        console.log('\n[3/8] 📥 Loading sidebar markup...');
        let filteredHTML = getCachedSidebarMarkup(userRole);
        if (!filteredHTML) {
            const sidebarHTML = await fetchSidebarHTML();
            console.log('\n[4/8] 🔍 Filtering sidebar by role...');
            filteredHTML = isSupabaseReady && userRole !== 'guest'
                ? filterSidebarByRole(sidebarHTML, userRole)
                : sidebarHTML;
            saveCachedSidebarMarkup(filteredHTML, userRole);
        } else {
            console.log(`✅ Reusing cached sidebar markup for role: ${userRole}`);
        }
        
        // Step 5: Insert into DOM
        console.log('\n[5/8] 📍 Inserting sidebar into DOM...');
        insertSidebarIntoDOM(filteredHTML);
        
        // Step 6: Mark current page
        console.log('\n[6/8] 📍 Marking current page...');
        markCurrentPageActive();
        
        // Step 7: Load user info
        console.log('\n[7/8] 👤 Loading user information...');
        await loadUserInfo();
        
        // Step 8: Setup event listeners
        console.log('\n[8/8] ⚙️  Setting up event listeners...');
        setupMobileMenu();
        setupSignOutButtons();
        await updateLowStockIndicator();
        syncUserInfo();
        setInterval(syncUserInfo, 1000);
        
        console.log('\n=====================================');
        console.log('✅ SIDEBAR LOADED SUCCESSFULLY!');
        console.log('=====================================\n');
        
    } catch (error) {
        console.error('\n=====================================');
        console.error('❌ SIDEBAR INITIALIZATION FAILED');
        console.error('=====================================');
        console.error(error);
        showSidebarError(error.message);
    }
}


window.refreshSidebar = async function() {
    console.log('🔄 Manually refreshing sidebar...');
    await loadSidebar();
};

// Export for debugging
window.sidebarDebug = {
    currentRole: () => window.currentUserRole,
    checkElements: () => ({
        sidebarExists: !!document.querySelector('.sidebar'),
        mobileHeaderExists: !!document.querySelector('.mobile-header'),
        appContainerExists: !!document.querySelector('.app-container')
    }),
    checkSupabase: () => ({
        clientExists: !!window.supabaseClient,
        type: typeof window.supabaseClient
    })
};


if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadSidebar);
} else {
    // Page already loaded
    loadSidebar();
}
