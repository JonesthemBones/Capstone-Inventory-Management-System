// audit_logs.js - Enhanced version with Stock Movements tab

let currentPage = 1;
const logsPerPage = 10;
let totalLogs = 0;
let currentFilters = {
    search: '',
    category: '',
    role: '',
    action: '',
    dateFrom: '',
    dateTo: ''
};

// Stock movements state
let currentStockPage = 1;
let totalStockMovements = 0;
let currentStockFilters = {
    search: '',
    movementType: '',
    dateFrom: '',
    dateTo: ''
};

// Current active view
let currentView = 'audit'; // 'audit' or 'stock'

const supabaseDb = supabaseClient;

// ===== TAB SWITCHING =====
function switchToAuditLogs() {
    currentView = 'audit';
    document.getElementById('audit-tab').classList.add('active');
    document.getElementById('stock-tab').classList.remove('active');
    document.getElementById('audit-logs-section').style.display = 'block';
    document.getElementById('stock-movements-section').style.display = 'none';
    loadAuditLogs();
}

function switchToStockMovements() {
    currentView = 'stock';
    document.getElementById('stock-tab').classList.add('active');
    document.getElementById('audit-tab').classList.remove('active');
    document.getElementById('stock-movements-section').style.display = 'block';
    document.getElementById('audit-logs-section').style.display = 'none';
    loadStockMovements();
}

// ===== AUDIT LOGS FUNCTIONS (Original) =====
async function populateFilterDropdowns() {
    try {
        const { data: categories } = await supabaseDb
            .from('audit_logs')
            .select('table_affected')
            .not('table_affected', 'is', null);

        const { data: actions } = await supabaseDb
            .from('audit_logs')
            .select('action_type')
            .not('action_type', 'is', null);

        const { data: users } = await supabaseDb
            .from('users')
            .select('role')
            .not('role', 'is', null);

        const uniqueCategories = [...new Set(categories.map(c => c.table_affected))].sort();
        const uniqueActions = [...new Set(actions.map(a => a.action_type))].sort();
        const uniqueRoles = [...new Set(users.map(u => u.role))].sort();

        const categorySelect = document.getElementById('category-filter');
        categorySelect.innerHTML = '<option value="">All Categories</option>' +
            uniqueCategories.map(cat => `<option value="${cat}">${beautifyText(cat)}</option>`).join('');

        const actionSelect = document.getElementById('action-filter');
        actionSelect.innerHTML = '<option value="">All Actions</option>' +
            uniqueActions.map(action => `<option value="${action}">${beautifyText(action)}</option>`).join('');

        const roleSelect = document.getElementById('role-filter');
        roleSelect.innerHTML = '<option value="">All Roles</option>' +
            uniqueRoles.map(role => `<option value="${role}">${beautifyText(role)}</option>`).join('');

    } catch (error) {
        console.error('Error populating filter dropdowns:', error);
    }
}

async function loadAuditLogs() {
    console.log('Starting loadAuditLogs function');
    const tableBody = document.getElementById('logs-table-body');
    
    tableBody.innerHTML = `
        <tr>
            <td colspan="6" class="loading-state">
                <i class="fas fa-spinner fa-spin"></i> Loading audit logs...
            </td>
        </tr>
    `;

    try {
        const session = await checkAuth();
        if (!session) {
            window.location.href = '/pages/auth.html';
            return;
        }

        const startRange = (currentPage - 1) * logsPerPage;
        const endRange = startRange + logsPerPage - 1;

        let query = supabaseDb
            .from('audit_logs')
            .select('*', { count: 'exact' });

        if (currentFilters.search) {
            query = query.or(`user_id.ilike.%${currentFilters.search}%,action_type.ilike.%${currentFilters.search}%,table_affected.ilike.%${currentFilters.search}%`);
        }

        if (currentFilters.category) {
            query = query.ilike('table_affected', `%${currentFilters.category}%`);
        }

        if (currentFilters.action) {
            query = query.ilike('action_type', `%${currentFilters.action}%`);
        }

        if (currentFilters.dateFrom) {
            query = query.gte('action_timestamp', currentFilters.dateFrom + 'T00:00:00');
        }

        if (currentFilters.dateTo) {
            query = query.lte('action_timestamp', currentFilters.dateTo + 'T23:59:59');
        }

        const { data: logs, count, error } = await query
            .order('action_timestamp', { ascending: false })
            .range(startRange, endRange);

        if (error) throw error;

        const userIds = Array.from(new Set((logs || []).map(log => log.user_id).filter(Boolean)));
        
        let usersMap = {};
        if (userIds.length > 0) {
            const { data: usersData } = await supabaseDb
                .from('users')
                .select('user_id, first_name, last_name, role')
                .in('user_id', userIds);
            
            usersMap = (usersData || []).reduce((acc, user) => {
                acc[user.user_id] = user;
                return acc;
            }, {});
        }

        const logsWithUserInfo = (logs || [])
            .map(log => {
                const user = usersMap[log.user_id];
                let fullName = '';
                let role = '';
                if (user) {
                    fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim();
                    role = user.role || '';
                } else {
                    fullName = log.user_id || '';
                    role = '';
                }
                return {
                    ...log,
                    fullName,
                    role,
                    action_type: log.action_type || '',
                    table_affected: log.table_affected || '',
                };
            })
            .filter(log => {
                if (currentFilters.role) {
                    return log.role.toLowerCase().includes(currentFilters.role.toLowerCase());
                }
                return true;
            });

        totalLogs = count || logsWithUserInfo.length;
        updateTable(logsWithUserInfo);
        updatePagination();

    } catch (error) {
        console.error('Error loading audit logs:', error);
        const tableBody = document.getElementById('logs-table-body');
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" class="error-state">
                    <i class="fas fa-exclamation-circle"></i>
                    Error loading audit logs: ${error.message}
                </td>
            </tr>
        `;
    }
}

function updateTable(logs) {
    const tbody = document.getElementById('logs-table-body');
    tbody.innerHTML = '';

    if (!logs || logs.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="no-data">No audit logs found</td>
            </tr>
        `;
        return;
    }

    logs.forEach(log => {
        const logForModal = { ...log };
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${new Date(log.action_timestamp).toLocaleString()}</td>
            <td>${escapeHtml(log.fullName || '')}</td>
            <td>${escapeHtml(beautifyText(log.role || ''))}</td>
            <td>${escapeHtml(beautifyText(log.action_type || ''))}</td>
            <td>${escapeHtml(beautifyText(log.table_affected || ''))}</td>
            <td>
                <button class="btn btn-link view-details-btn">
                    View Details
                </button>
            </td>
        `;
        const button = row.querySelector('.view-details-btn');
        if (button) {
            button.addEventListener('click', () => showLogDetails(logForModal));
        }
        tbody.appendChild(row);
    });

    document.getElementById('logs-count').textContent = 
        `Showing ${logs.length} of ${totalLogs} entries`;
}

function updatePagination() {
    const totalPages = Math.ceil(totalLogs / logsPerPage);
    const start = ((currentPage - 1) * logsPerPage) + 1;
    const end = Math.min(currentPage * logsPerPage, totalLogs);

    document.getElementById('showing-start').textContent = totalLogs ? start : 0;
    document.getElementById('showing-end').textContent = end;
    document.getElementById('total-logs').textContent = totalLogs;
    document.getElementById('current-page').textContent = currentPage;
    document.getElementById('total-pages').textContent = totalPages;

    document.getElementById('first-page-btn').disabled = currentPage === 1;
    document.getElementById('prev-page-btn').disabled = currentPage === 1;
    document.getElementById('next-page-btn').disabled = currentPage === totalPages;
    document.getElementById('last-page-btn').disabled = currentPage === totalPages;
}

function applyFilters() {
    currentFilters = {
        search: document.getElementById('log-search').value,
        category: document.getElementById('category-filter').value,
        role: document.getElementById('role-filter').value,
        action: document.getElementById('action-filter').value,
        dateFrom: document.getElementById('date-from').value,
        dateTo: document.getElementById('date-to').value
    };
    currentPage = 1;
    loadAuditLogs();
}

function resetFilters() {
    document.getElementById('log-search').value = '';
    document.getElementById('category-filter').value = '';
    document.getElementById('role-filter').value = '';
    document.getElementById('action-filter').value = '';
    document.getElementById('date-from').value = '';
    document.getElementById('date-to').value = '';
    currentFilters = {
        search: '',
        category: '',
        role: '',
        action: '',
        dateFrom: '',
        dateTo: ''
    };
    currentPage = 1;
    loadAuditLogs();
}

function goToPage(page) {
    currentPage = page;
    loadAuditLogs();
}

// ===== STOCK MOVEMENTS FUNCTIONS =====
async function loadStockMovements() {
    console.log('Loading stock movements');
    const tableBody = document.getElementById('stock-table-body');
    
    tableBody.innerHTML = `
        <tr>
            <td colspan="8" class="loading-state">
                <i class="fas fa-spinner fa-spin"></i> Loading stock movements...
            </td>
        </tr>
    `;

    try {
        const session = await checkAuth();
        if (!session) {
            window.location.href = '/pages/auth.html';
            return;
        }

        const startRange = (currentStockPage - 1) * logsPerPage;
        const endRange = startRange + logsPerPage - 1;

        let query = supabaseDb
            .from('stock_movements')
            .select(`
                *,
                products(product_name, product_code, unit_of_measure)
            `, { count: 'exact' });

        if (currentStockFilters.search) {
            query = query.or(`reference_id.ilike.%${currentStockFilters.search}%,notes.ilike.%${currentStockFilters.search}%`);
        }

        if (currentStockFilters.movementType) {
            query = query.eq('movement_type', currentStockFilters.movementType);
        }

        if (currentStockFilters.dateFrom) {
            query = query.gte('movement_date', currentStockFilters.dateFrom + 'T00:00:00');
        }

        if (currentStockFilters.dateTo) {
            query = query.lte('movement_date', currentStockFilters.dateTo + 'T23:59:59');
        }

        const { data: movements, count, error } = await query
            .order('movement_date', { ascending: false })
            .range(startRange, endRange);

        if (error) throw error;

        const userIds = Array.from(new Set((movements || []).map(m => m.performed_by).filter(Boolean)));
        
        let usersMap = {};
        if (userIds.length > 0) {
            const { data: usersData } = await supabaseDb
                .from('users')
                .select('user_id, first_name, last_name')
                .in('user_id', userIds);
            
            usersMap = (usersData || []).reduce((acc, user) => {
                acc[user.user_id] = `${user.first_name || ''} ${user.last_name || ''}`.trim();
                return acc;
            }, {});
        }

        const movementsWithUserInfo = (movements || []).map(movement => ({
            ...movement,
            performedByName: usersMap[movement.performed_by] || movement.performed_by || 'System'
        }));

        totalStockMovements = count || movementsWithUserInfo.length;
        updateStockTable(movementsWithUserInfo);
        updateStockPagination();

    } catch (error) {
        console.error('Error loading stock movements:', error);
        tableBody.innerHTML = `
            <tr>
                <td colspan="8" class="error-state">
                    <i class="fas fa-exclamation-circle"></i>
                    Error loading stock movements: ${error.message}
                </td>
            </tr>
        `;
    }
}

function updateStockTable(movements) {
    const tbody = document.getElementById('stock-table-body');
    tbody.innerHTML = '';

    if (!movements || movements.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="no-data">No stock movements found</td>
            </tr>
        `;
        return;
    }

    movements.forEach(movement => {
        const row = document.createElement('tr');
        const movementTypeClass = movement.movement_type === 'inbound' ? 'badge-success' : 'badge-warning';
        const quantityClass = movement.quantity_change > 0 ? 'text-success' : 'text-danger';
        const quantitySign = movement.quantity_change > 0 ? '+' : '';
        
        row.innerHTML = `
            <td>${new Date(movement.movement_date).toLocaleString()}</td>
            <td>
                <strong>${escapeHtml(movement.products?.product_name || 'Unknown')}</strong><br>
                <small style="color: var(--text-secondary);">${escapeHtml(movement.products?.product_code || '')}</small>
            </td>
            <td>
                <span class="badge ${movementTypeClass}">
                    ${beautifyText(movement.movement_type)}
                </span>
            </td>
            <td>${escapeHtml(beautifyText(movement.reference_type || ''))}</td>
            <td><strong>${escapeHtml(movement.reference_id || '')}</strong></td>
            <td class="${quantityClass}">
                <strong>${quantitySign}${movement.quantity_change} ${movement.products?.unit_of_measure || ''}</strong>
            </td>
            <td>${movement.quantity_after || 0} ${movement.products?.unit_of_measure || ''}</td>
            <td>${escapeHtml(movement.performedByName)}</td>
        `;
        tbody.appendChild(row);
    });

    document.getElementById('stock-count').textContent = 
        `Showing ${movements.length} of ${totalStockMovements} movements`;
}

function updateStockPagination() {
    const totalPages = Math.ceil(totalStockMovements / logsPerPage);
    const start = ((currentStockPage - 1) * logsPerPage) + 1;
    const end = Math.min(currentStockPage * logsPerPage, totalStockMovements);

    document.getElementById('stock-showing-start').textContent = totalStockMovements ? start : 0;
    document.getElementById('stock-showing-end').textContent = end;
    document.getElementById('stock-total').textContent = totalStockMovements;
    document.getElementById('stock-current-page').textContent = currentStockPage;
    document.getElementById('stock-total-pages').textContent = totalPages;

    document.getElementById('stock-first-page-btn').disabled = currentStockPage === 1;
    document.getElementById('stock-prev-page-btn').disabled = currentStockPage === 1;
    document.getElementById('stock-next-page-btn').disabled = currentStockPage === totalPages;
    document.getElementById('stock-last-page-btn').disabled = currentStockPage === totalPages;
}

function applyStockFilters() {
    currentStockFilters = {
        search: document.getElementById('stock-search').value,
        movementType: document.getElementById('movement-type-filter').value,
        dateFrom: document.getElementById('stock-date-from').value,
        dateTo: document.getElementById('stock-date-to').value
    };
    currentStockPage = 1;
    loadStockMovements();
}

function resetStockFilters() {
    document.getElementById('stock-search').value = '';
    document.getElementById('movement-type-filter').value = '';
    document.getElementById('stock-date-from').value = '';
    document.getElementById('stock-date-to').value = '';
    currentStockFilters = {
        search: '',
        movementType: '',
        dateFrom: '',
        dateTo: ''
    };
    currentStockPage = 1;
    loadStockMovements();
}

function goToStockPage(page) {
    currentStockPage = page;
    loadStockMovements();
}

// ===== EXPORT FUNCTIONS =====
async function exportCurrentView() {
    if (currentView === 'audit') {
        await exportAuditLogs();
    } else {
        await exportStockMovements();
    }
}

async function exportAuditLogs() {
    try {
        const exportButton = document.getElementById('export-logs-btn');
        const originalText = exportButton.textContent;
        exportButton.textContent = 'Exporting...';
        exportButton.disabled = true;

        const { data: logs, error } = await supabaseDb
            .from('audit_logs')
            .select('*')
            .order('action_timestamp', { ascending: false });

        if (error) throw error;

        const userIds = Array.from(new Set(logs.map(log => log.user_id).filter(Boolean)));
        const { data: usersData } = await supabaseDb
            .from('users')
            .select('user_id, first_name, last_name, role')
            .in('user_id', userIds);

        const usersMap = (usersData || []).reduce((acc, user) => {
            acc[user.user_id] = user;
            return acc;
        }, {});

        const logsWithUserInfo = logs.map(log => {
            const user = usersMap[log.user_id];
            return {
                ...log,
                fullName: user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : log.user_id || '',
                role: user ? user.role || '' : ''
            };
        });

        const csv = convertToCSV(logsWithUserInfo);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        downloadCSV(csv, `audit_logs_${timestamp}.csv`);

        exportButton.textContent = originalText;
        exportButton.disabled = false;

    } catch (error) {
        console.error('Error exporting audit logs:', error);
        alert('Error exporting to CSV. Please try again.');
    }
}

async function exportStockMovements() {
    try {
        const exportButton = document.getElementById('export-logs-btn');
        const originalText = exportButton.textContent;
        exportButton.textContent = 'Exporting...';
        exportButton.disabled = true;

        const { data: movements, error } = await supabaseDb
            .from('stock_movements')
            .select(`
                *,
                products(product_name, product_code, unit_of_measure)
            `)
            .order('movement_date', { ascending: false });

        if (error) throw error;

        const userIds = Array.from(new Set(movements.map(m => m.performed_by).filter(Boolean)));
        const { data: usersData } = await supabaseDb
            .from('users')
            .select('user_id, first_name, last_name')
            .in('user_id', userIds);

        const usersMap = (usersData || []).reduce((acc, user) => {
            acc[user.user_id] = `${user.first_name || ''} ${user.last_name || ''}`.trim();
            return acc;
        }, {});

        const movementsForExport = movements.map(movement => ({
            movement_date: movement.movement_date,
            product_name: movement.products?.product_name || '',
            product_code: movement.products?.product_code || '',
            movement_type: movement.movement_type,
            reference_type: movement.reference_type,
            reference_id: movement.reference_id,
            quantity_change: movement.quantity_change,
            quantity_after: movement.quantity_after,
            unit_of_measure: movement.products?.unit_of_measure || '',
            performed_by: usersMap[movement.performed_by] || 'System',
            notes: movement.notes || ''
        }));

        const csv = convertStockMovementsToCSV(movementsForExport);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        downloadCSV(csv, `stock_movements_${timestamp}.csv`);

        exportButton.textContent = originalText;
        exportButton.disabled = false;

    } catch (error) {
        console.error('Error exporting stock movements:', error);
        alert('Error exporting to CSV. Please try again.');
    }
}

function convertStockMovementsToCSV(movements) {
    const columns = [
        { key: 'movement_date', header: 'Date & Time' },
        { key: 'product_name', header: 'Product Name' },
        { key: 'product_code', header: 'Product Code' },
        { key: 'movement_type', header: 'Movement Type' },
        { key: 'reference_type', header: 'Reference Type' },
        { key: 'reference_id', header: 'Reference ID' },
        { key: 'quantity_change', header: 'Quantity Change' },
        { key: 'quantity_after', header: 'Stock After' },
        { key: 'unit_of_measure', header: 'Unit' },
        { key: 'performed_by', header: 'Performed By' },
        { key: 'notes', header: 'Notes' }
    ];

    const BOM = '\uFEFF';
    const headerRow = columns.map(col => col.header).join(',');

    const csvRows = movements.map(obj => {
        return columns.map(col => {
            let value = obj[col.key];
            
            if (col.key === 'movement_date' && value) {
                value = new Date(value).toLocaleString();
            }
            
            if (col.key === 'movement_type' && value) {
                value = beautifyText(value);
            }

            if (value === null || value === undefined) {
                value = '';
            }

            value = String(value)
                .replace(/"/g, '""')
                .replace(/\n/g, ' ')
                .replace(/\r/g, '');

            if (/[",\n\r]/.test(value)) {
                value = `"${value}"`;
            }

            return value;
        }).join(',');
    });

    return BOM + [headerRow, ...csvRows].join('\r\n');
}

function convertToCSV(objArray) {
    const columns = [
        { key: 'action_timestamp', header: 'Timestamp' },
        { key: 'fullName', header: 'User Name' },
        { key: 'role', header: 'User Role' },
        { key: 'action_type', header: 'Action Type' },
        { key: 'table_affected', header: 'Category' },
        { key: 'record_id', header: 'Record ID' },
        { key: 'old_values', header: 'Old Values' },
        { key: 'new_values', header: 'New Values' },
        { key: 'ip_address', header: 'IP Address' },
        { key: 'user_agent', header: 'User Agent' }
    ];

    const BOM = '\uFEFF';
    const headerRow = columns.map(col => col.header).join(',');

    const csvRows = objArray.map(obj => {
        return columns.map(col => {
            let value = obj[col.key];
            
            if (col.key === 'action_timestamp' && value) {
                value = new Date(value).toLocaleString();
            }
            
            if (['old_values', 'new_values'].includes(col.key) && value) {
                try {
                    if (typeof value === 'string') {
                        value = JSON.parse(value);
                    }
                    if (typeof value === 'object' && value !== null) {
                        value = Object.entries(value)
                            .map(([k, v]) => `${beautifyText(k)}: ${v}`)
                            .join(' | ');
                    }
                } catch (e) {
                    value = String(value);
                }
            }

            if (['role', 'action_type', 'table_affected'].includes(col.key) && value) {
                value = beautifyText(value);
            }

            if (value === null || value === undefined) {
                value = '';
            }

            value = String(value)
                .replace(/"/g, '""')
                .replace(/\n/g, ' ')
                .replace(/\r/g, '');

            if (/[",\n\r]/.test(value)) {
                value = `"${value}"`;
            }

            return value;
        }).join(',');
    });

    return BOM + [headerRow, ...csvRows].join('\r\n');
}

function downloadCSV(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');

    if (navigator.msSaveBlob) {
        navigator.msSaveBlob(blob, filename);
    } else {
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

// ===== HELPER FUNCTIONS =====
function showLogDetails(logData) {
    const log = typeof logData === 'string' ? JSON.parse(logData) : logData;
    const modal = document.getElementById('log-details-modal');
    const content = document.getElementById('log-details-content');
    
    content.innerHTML = `
        <div class="log-details">
            <div class="detail-group">
                <label>Timestamp:</label>
                <span>${log.action_timestamp ? new Date(log.action_timestamp).toLocaleString() : ''}</span>
            </div>
            <div class="detail-group">
                <label>User:</label>
                <span>${escapeHtml(String(log.fullName || ''))}</span>
            </div>
            <div class="detail-group">
                <label>Role:</label>
                <span>${escapeHtml(beautifyText(String(log.role || '')))}</span>
            </div>
            <div class="detail-group">
                <label>Action:</label>
                <span>${escapeHtml(beautifyText(String(log.action_type || '')))}</span>
            </div>
            <div class="detail-group">
                <label>Category:</label>
                <span>${escapeHtml(beautifyText(String(log.table_affected || '')))}</span>
            </div>
            <div class="detail-group">
                <label>Record ID:</label>
                <span>${escapeHtml(String(log.record_id || ''))}</span>
            </div>
            <div class="detail-group">
                <label>Old Values:</label>
                <pre>${escapeHtml(JSON.stringify(log.old_values || {}, null, 2))}</pre>
            </div>
            <div class="detail-group">
                <label>New Values:</label>
                <pre>${escapeHtml(JSON.stringify(log.new_values || {}, null, 2))}</pre>
            </div>
            <div class="detail-group">
                <label>IP Address:</label>
                <span>${escapeHtml(String(log.ip_address || ''))}</span>
            </div>
            <div class="detail-group">
                <label>User Agent:</label>
                <span>${escapeHtml(String(log.user_agent || ''))}</span>
            </div>
        </div>
    `;
    
    modal.style.display = 'block';
}

function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function beautifyText(text) {
    if (!text) return '';
    return text
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', async () => {
    const session = await requireAuth();
    if (!session) return;
    
    // Check role access - only admin and manager can access audit logs
    const hasAccess = await window.authHelpers.requireRole(['admin', 'manager']);
    if (!hasAccess) return;
    
    initializeEventListeners();
    await populateFilterDropdowns();
    await loadAuditLogs();
});

function initializeEventListeners() {
    // Tab switching
    document.getElementById('audit-tab')?.addEventListener('click', switchToAuditLogs);
    document.getElementById('stock-tab')?.addEventListener('click', switchToStockMovements);
    
    // Audit logs filters
    document.getElementById('apply-filters-btn')?.addEventListener('click', applyFilters);
    document.getElementById('reset-filters-btn')?.addEventListener('click', resetFilters);
    
    // Stock movements filters
    document.getElementById('apply-stock-filters-btn')?.addEventListener('click', applyStockFilters);
    document.getElementById('reset-stock-filters-btn')?.addEventListener('click', resetStockFilters);
    
    // Export button (handles both views)
    document.getElementById('export-logs-btn')?.addEventListener('click', exportCurrentView);

    // Audit logs pagination
    document.getElementById('first-page-btn')?.addEventListener('click', () => goToPage(1));
    document.getElementById('prev-page-btn')?.addEventListener('click', () => goToPage(currentPage - 1));
    document.getElementById('next-page-btn')?.addEventListener('click', () => goToPage(currentPage + 1));
    document.getElementById('last-page-btn')?.addEventListener('click', () => goToPage(Math.ceil(totalLogs / logsPerPage)));
    
    // Stock movements pagination
    document.getElementById('stock-first-page-btn')?.addEventListener('click', () => goToStockPage(1));
    document.getElementById('stock-prev-page-btn')?.addEventListener('click', () => goToStockPage(currentStockPage - 1));
    document.getElementById('stock-next-page-btn')?.addEventListener('click', () => goToStockPage(currentStockPage + 1));
    document.getElementById('stock-last-page-btn')?.addEventListener('click', () => goToStockPage(Math.ceil(totalStockMovements / logsPerPage)));
    
    // Modal close
    document.getElementById('close-log-details')?.addEventListener('click', () => {
        document.getElementById('log-details-modal').style.display = 'none';
    });
    
    // Close modal when clicking outside
    window.addEventListener('click', (event) => {
        const modal = document.getElementById('log-details-modal');
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    });
}
