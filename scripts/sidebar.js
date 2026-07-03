const sidebarConfig = [
    {
        id: 'dashboard',
        title: 'Dashboard',
        icon: 'fas fa-tachometer-alt',
        path: 'pages/dashboard.html',
        permission: ['admin', 'manager']
    },
    {
        id: 'inventory',
        title: 'Inventory Management',
        icon: 'fas fa-box',
        path: 'pages/inventory.html',
        permission: ['admin', 'manager', 'cashier', 'staff']
    },
    {
        id: 'reports',
        title: 'Reports',
        icon: 'fas fa-file-alt',
        path: 'pages/reports.html',
        permission: ['admin', 'manager']
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

async function loadSidebar() {
    try {
        // Get user role FIRST before loading sidebar
        const userRole = await getUserRole();
        console.log('✓ User role fetched:', userRole);
        window.currentUserRole = userRole;
        
        // Fetch sidebar HTML
        const response = await fetch('../components/sidebar.html');
        let sidebarContent = await response.text();
        
        // Parse HTML and filter based on role BEFORE inserting into DOM
        const parser = new DOMParser();
        const doc = parser.parseFromString(sidebarContent, 'text/html');
        
        // Remove unauthorized nav items from both desktop and mobile
        const allNavItems = doc.querySelectorAll('.nav-item[data-permission], .mobile-nav-item[data-permission]');
        
        console.log(`Found ${allNavItems.length} nav items to filter`);
        
        allNavItems.forEach(item => {
            const permissionAttr = item.getAttribute('data-permission');
            if (permissionAttr) {
                const allowedRoles = permissionAttr.split(',').map(r => r.trim().toLowerCase());
                const userRoleLower = userRole.toLowerCase();
                const isAllowed = allowedRoles.includes(userRoleLower);
                
                const itemText = item.textContent.trim().split('\n')[0];
                
                console.log(`Checking: ${itemText}`);
                console.log(`  Required roles: ${allowedRoles.join(', ')}`);
                console.log(`  User role: ${userRoleLower}`);
                console.log(`  Access granted: ${isAllowed}`);
                
                if (!isAllowed) {
                    console.log(`  ❌ REMOVING this item`);
                    item.remove(); // Completely remove from DOM
                } else {
                    console.log(`  ✅ KEEPING this item`);
                }
            }
        });
        
        // Remove empty sections
        const sections = doc.querySelectorAll('.sidebar-section, .mobile-nav-section');
        sections.forEach(section => {
            const items = section.querySelectorAll('.nav-item, .mobile-nav-item');
            if (items.length === 0) {
                console.log('Removing empty section');
                section.remove();
            }
        });
        
        // Convert back to HTML string
        sidebarContent = doc.body.innerHTML;
        
        // Now insert the filtered sidebar
        const appContainer = document.querySelector('.app-container');
        if (appContainer) {
            appContainer.insertAdjacentHTML('afterbegin', sidebarContent);
            
            // Mark current page as active
            const currentPage = window.location.pathname.split('/').pop();
            const navItems = document.querySelectorAll('.nav-item, .mobile-nav-item');
            navItems.forEach(item => {
                if (item.getAttribute('href').includes(currentPage)) {
                    item.classList.add('active');
                }
            });
            
            // Load user display info
            await loadUserInfo();
            await updateLowStockIndicator();
            setupMobileMenu();
            setupSignOutButtons();
            
            // Start syncing user info
            syncUserInfo();
            setInterval(syncUserInfo, 1000);

            console.log('✅ Sidebar loaded and filtered successfully');
            
            if (window.mobileResponsive) {
                window.mobileResponsive.init();
            }
        }
    } catch (error) {
        console.error('Error loading sidebar:', error);
    }
}

async function getUserRole() {
    try {
        const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
        
        if (authError) throw authError;
        if (!user) {
            console.warn('No authenticated user found');
            return 'staff';
        }

        const { data: userData, error: dbError } = await supabaseClient
            .from('users')
            .select('role')
            .eq('user_id', user.id)
            .single();

        if (dbError) {
            console.error('Error fetching user role:', dbError);
            return 'staff';
        }
        
        return (userData?.role || 'staff').toLowerCase();

    } catch (error) {
        console.error('Error getting user role:', error);
        return 'staff';
    }
}

async function loadUserInfo() {
    try {
        const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
        
        if (authError) throw authError;
        if (!user) {
            console.warn('No authenticated user found');
            return;
        }

        const { data: userData, error: dbError } = await supabaseClient
            .from('users')
            .select('first_name, last_name, email, role')
            .eq('user_id', user.id)
            .single();

        if (dbError) {
            console.error('Error fetching user data:', dbError);
            updateUserDisplay(null, user.email);
            return;
        }
        
        updateUserDisplay(userData, user.email);

    } catch (error) {
        console.error('Error loading user info:', error);
    }
}

async function checkLowStockItems() {
    try {
        const { data: lowStockItems } = await supabaseClient
            .from('inventory_stock')
            .select('quantity') 
            .lt('quantity', 10)
            .gt('quantity', 0);
        return lowStockItems && lowStockItems.length > 0;
    } catch (error) {
        console.error('Error checking low stock items:', error);
        return false;
    }
}

async function checkOutOfStockItems() {
    try {
        const { data: outOfStockItems } = await supabaseClient
            .from('inventory_stock')
            .select('quantity')
            .eq('quantity', 0);
        return outOfStockItems && outOfStockItems.length > 0;
    } catch (error) {
        console.error('Error checking out of stock items:', error);
        return false;
    }
}

async function updateLowStockIndicator() {
    try {
        const hasLowStock = await checkLowStockItems();
        const hasOutOfStock = await checkOutOfStockItems();
        const dashboardNavItem = document.querySelector('a[href="../pages/dashboard.html"]');
        const indicatorDot = dashboardNavItem ? dashboardNavItem.querySelector('.indicator-dot') : null;

        if (indicatorDot) {
            if (hasOutOfStock) {
                indicatorDot.style.display = 'block';
                indicatorDot.classList.add('flashing');
                indicatorDot.classList.remove('low-stock');
            } else if (hasLowStock) {
                indicatorDot.style.display = 'block';
                indicatorDot.classList.add('low-stock');
                indicatorDot.classList.remove('flashing');
            } else {
                indicatorDot.style.display = 'none';
                indicatorDot.classList.remove('low-stock', 'flashing');
            }
        }
    } catch (error) {
        console.error('Error updating low stock indicator:', error);
    }
}

function updateUserDisplay(userData, fallbackEmail) {
    const userNameElements = document.querySelectorAll('.user-name, .mobile-user-name');
    const userRoleElements = document.querySelectorAll('.user-role, .mobile-user-role');

    if (userData && userData.first_name && userData.last_name) {
        userNameElements.forEach(element => {
            if (element) {
                element.textContent = `${userData.first_name} ${userData.last_name}`;
            }
        });
        userRoleElements.forEach(element => {
            if (element) {
                const roleText = userData.role ? userData.role.charAt(0).toUpperCase() + userData.role.slice(1) : 'User';
                element.textContent = roleText;
            }
        });
    } else {    
        userNameElements.forEach(element => {
            if (element) {
                element.textContent = fallbackEmail || 'Guest';
            }
        });
        userRoleElements.forEach(element => {
            if (element) {
                element.textContent = '';
            }
        });
    }
}

function setupMobileMenu() {
    const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
    const mobileNavDropdown = document.getElementById('mobile-nav-dropdown');
    const mobileNavItems = document.querySelectorAll('.mobile-nav-item');

    if (!mobileMenuToggle || !mobileNavDropdown) {
        console.error('Mobile menu elements not found');
        return;
    }

    mobileMenuToggle.addEventListener('click', function(e) {
        e.stopPropagation();
        mobileNavDropdown.classList.toggle('open');
        
        const icon = this.querySelector('i');
        if (mobileNavDropdown.classList.contains('open')) {
            icon.classList.remove('fa-bars');
            icon.classList.add('fa-times');
        } else {
            icon.classList.remove('fa-times');
            icon.classList.add('fa-bars');
        }
    });

    mobileNavItems.forEach(item => {
        item.addEventListener('click', function() {
            if (mobileNavDropdown) {
                mobileNavDropdown.classList.remove('open');
                const icon = mobileMenuToggle?.querySelector('i');
                if (icon) {
                    icon.classList.remove('fa-times');
                    icon.classList.add('fa-bars');
                }
            }
        });
    });

    document.addEventListener('click', function(event) {
        if (mobileNavDropdown && mobileMenuToggle) {
            const isClickInside = mobileNavDropdown.contains(event.target) || 
                                mobileMenuToggle.contains(event.target);
            
            if (!isClickInside && mobileNavDropdown.classList.contains('open')) {
                mobileNavDropdown.classList.remove('open');
                const icon = mobileMenuToggle.querySelector('i');
                if (icon) {
                    icon.classList.remove('fa-times');
                    icon.classList.add('fa-bars');
                }
            }
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
                
                const { error } = await supabaseClient.auth.signOut();
                if (error) throw error;
                
                if (window.utils && window.utils.showToast) {
                    window.utils.showToast('Signing out...', 'success');
                    setTimeout(() => {
                        window.location.href = '../pages/auth.html?logged_out=true';
                    }, 1000);
                } else {
                    alert('✅ You have been signed out successfully');
                    window.location.href = '../pages/auth.html?logged_out=true';
                }
                
            } catch (error) {
                console.error('Error signing out:', error);
                btn.innerHTML = originalHTML;
                btn.style.pointerEvents = 'auto';
                
                if (window.utils && window.utils.showToast) {
                    window.utils.showToast('Error signing out: ' + error.message, 'error');
                } else {
                    alert('❌ Error signing out: ' + error.message);
                }
            }
        });
    });
}

function syncUserInfo() {
    const desktopUserName = document.querySelector('.sidebar .user-name');
    const desktopUserRole = document.querySelector('.sidebar .user-role');
    const mobileUserName = document.querySelector('.mobile-user-name');
    const mobileUserRole = document.querySelector('.mobile-user-role');

    if (desktopUserName && mobileUserName) {
        mobileUserName.textContent = desktopUserName.textContent;
    }
    if (desktopUserRole && mobileUserRole) {
        mobileUserRole.textContent = desktopUserRole.textContent;
    }
}

// Initialize sidebar on page load
document.addEventListener('DOMContentLoaded', loadSidebar);
