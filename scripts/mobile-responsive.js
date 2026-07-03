class MobileResponsive {
    constructor() {
        this.sidebarOpen = false;
        this.isMobile = window.innerWidth <= 768;
        this.initialized = false;
        this.init();
    }

    init() {
        // Wait for sidebar to be loaded before initializing
        const checkSidebar = setInterval(() => {
            const sidebar = document.querySelector('.sidebar');
            if (sidebar && !this.initialized) {
                clearInterval(checkSidebar);
                this.initialized = true;
                this.setupEventListeners();
                this.handleResize();
                console.log('Mobile responsive initialized');
            }
        }, 100);

        // Timeout after 5 seconds
        setTimeout(() => {
            clearInterval(checkSidebar);
            if (!this.initialized) {
                console.warn('Sidebar not found after 5 seconds');
            }
        }, 5000);
    }

    setupEventListeners() {
        // Listen for window resize
        window.addEventListener('resize', () => this.handleResize());
        
        // Mobile menu button click - use event delegation
        document.addEventListener('click', (e) => {
            const menuBtn = e.target.closest('.mobile-menu-btn');
            if (menuBtn) {
                e.preventDefault();
                e.stopPropagation();
                this.toggleSidebar();
            }
        });

        // Close sidebar when clicking overlay
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('sidebar-overlay') && this.isMobile && this.sidebarOpen) {
                this.closeSidebar();
            }
        });

        // Close sidebar when clicking nav items on mobile
        document.addEventListener('click', (e) => {
            const navItem = e.target.closest('.nav-item');
            if (navItem && this.isMobile && this.sidebarOpen) {
                // Don't close immediately, let navigation happen
                setTimeout(() => this.closeSidebar(), 100);
            }
        });

        // Handle escape key to close sidebar
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isMobile && this.sidebarOpen) {
                this.closeSidebar();
            }
        });

        console.log('Event listeners set up');
    }

    handleResize() {
        const newIsMobile = window.innerWidth <= 768;
        
        if (newIsMobile !== this.isMobile) {
            this.isMobile = newIsMobile;
            
            if (!this.isMobile) {
                const sidebar = document.querySelector('.sidebar');
                const overlay = document.querySelector('.sidebar-overlay');
                
                if (sidebar) {
                    sidebar.classList.remove('mobile-open');
                }
                if (overlay) {
                    overlay.classList.remove('mobile-open');
                }
                document.body.style.overflow = '';
                this.sidebarOpen = false;
            } else {
                this.closeSidebar();
            }
        }
    }

    toggleSidebar() {
        console.log('Toggle sidebar - currently open:', this.sidebarOpen);
        if (this.sidebarOpen) {
            this.closeSidebar();
        } else {
            this.openSidebar();
        }
    }

    openSidebar() {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.querySelector('.sidebar-overlay');
        
        console.log('Opening sidebar', { sidebar: !!sidebar, overlay: !!overlay });
        
        if (sidebar) {
            sidebar.classList.add('mobile-open');
            this.sidebarOpen = true;
        }
        
        if (overlay) {
            overlay.classList.add('mobile-open');
        }

        if (this.isMobile) {
            document.body.style.overflow = 'hidden';
        }
    }

    closeSidebar() {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.querySelector('.sidebar-overlay');
        
        console.log('Closing sidebar');
        
        if (sidebar) {
            sidebar.classList.remove('mobile-open');
            this.sidebarOpen = false;
        }
        
        if (overlay) {
            overlay.classList.remove('mobile-open');
        }
        document.body.style.overflow = '';
    }
    isMobileView() {
        return window.innerWidth <= 768;
    }
    getBreakpoint() {
        const width = window.innerWidth;
        if (width <= 480) return 'xs';
        if (width <= 768) return 'sm';
        if (width <= 1024) return 'md';
        if (width <= 1280) return 'lg';
        return 'xl';
    }
}

// Initialize after a slight delay to ensure DOM is ready
function initMobileResponsive() {
    if (!window.mobileResponsive) {
        console.log('Initializing mobile responsive...');
        window.mobileResponsive = new MobileResponsive();
    }
}

// Try multiple initialization methods
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileResponsive);
} else {
    initMobileResponsive();
}

// Also try after a short delay as fallback
setTimeout(initMobileResponsive, 500);