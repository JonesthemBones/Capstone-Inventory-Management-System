let salesTrendChart = null;
let stockDistributionChart = null;
let categoryChart = null;
let supplierFrequencyChart = null;
let dashboardRole = 'guest';
let dashboardUserId = null;

const LOW_STOCK_PERCENTAGE = 0.25;
const CRITICAL_STOCK_PERCENTAGE = 0.10;

function getStockThresholds(product = {}) {
    const maximumStock = Number(product.maximum_stock || 0);
    const reorderLevel = Math.max(0, Number(product.reorder_level || 0));

    if (maximumStock > 0) {
        return {
            low: Math.ceil(maximumStock * LOW_STOCK_PERCENTAGE),
            critical: Math.ceil(maximumStock * CRITICAL_STOCK_PERCENTAGE)
        };
    }

    return {
        low: reorderLevel,
        critical: reorderLevel > 0 ? Math.max(1, Math.ceil(reorderLevel * (CRITICAL_STOCK_PERCENTAGE / LOW_STOCK_PERCENTAGE))) : 0
    };
}

function getDashboardStockStatus(quantity, product = {}) {
    const currentQuantity = Number(quantity || 0);
    const thresholds = getStockThresholds(product);

    if (currentQuantity <= 0) return 'out_of_stock';
    if (thresholds.critical > 0 && currentQuantity <= thresholds.critical) return 'critical';
    if (thresholds.low > 0 && currentQuantity <= thresholds.low) return 'low_stock';
    return 'in_stock';
}

function formatProductNames(items, limit = 3) {
    const names = items.slice(0, limit).map(item => item.product?.product_name || 'Unknown product');
    const remaining = items.length - names.length;
    return `${names.join(', ')}${remaining > 0 ? `, and ${remaining} more` : ''}`;
}

document.addEventListener('DOMContentLoaded', async () => {
    const session = await window.authHelpers.requireAuth();
    if (!session) return;
    
    const hasAccess = await window.authHelpers.requireRole(['owner', 'admin', 'manager', 'cashier', 'staff']);
    if (!hasAccess) return;

    dashboardRole = await window.authHelpers.getUserRole();
    dashboardUserId = session.user?.id || (await window.authHelpers.getCurrentUser())?.id;
    configureDashboardForRole(dashboardRole);
    initializeCharts();
    window.authHelpers.revealProtectedContent();

    if (dashboardRole === 'cashier') {
        await loadCashierDashboard();
        await loadRecentActivity();
        window.setInterval(() => {
            loadCashierDashboard();
            loadRecentActivity();
        }, 120000);
        return;
    }

    await loadDashboardStats();
    await loadRecentActivity();
    await loadLowStockAlerts();
    await showLowStockNotifications();
    setupRealtimeSubscriptions();
});

function configureDashboardForRole(role) {
    const title = document.querySelector('.page-title');
    const subtitle = document.querySelector('.page-subtitle');
    const statTitles = [...document.querySelectorAll('.stat-title')];
    const statChanges = [...document.querySelectorAll('.stat-change span')];
    const panels = document.querySelectorAll('[data-dashboard-panel]');
    const alerts = document.querySelector('.alerts-section');
    const activityTitle = document.getElementById('activity-title');
    const activitySubtitle = document.getElementById('activity-subtitle');
    const trendTitle = document.getElementById('trend-title');
    const trendSubtitle = document.getElementById('trend-subtitle');
    const distributionTitle = document.getElementById('distribution-title');
    const distributionSubtitle = document.getElementById('distribution-subtitle');

    const setPanelVisibility = visiblePanels => {
        panels.forEach(panel => {
            panel.hidden = !visiblePanels.includes(panel.dataset.dashboardPanel);
            panel.classList.remove('dashboard-panel-wide');
        });
    };

    if (role === 'cashier') {
        title.textContent = 'Cashier Dashboard';
        subtitle.textContent = 'Your sales and transaction summary for today';
        ['Today\'s Sales', 'Transactions', 'Items Sold', 'Average Sale'].forEach((label, index) => {
            if (statTitles[index]) statTitles[index].textContent = label;
        });
        ['Your completed sales today', 'Your transaction count today', 'Units sold today', 'Average transaction value'].forEach((label, index) => {
            if (statChanges[index]) statChanges[index].textContent = label;
        });
        setPanelVisibility(['sales-trend', 'stock-distribution', 'recent-activity']);
        document.querySelector('[data-dashboard-panel="recent-activity"]')?.classList.add('dashboard-panel-wide');
        if (alerts) alerts.style.display = 'none';
        activityTitle.textContent = 'My Recent Transactions';
        activitySubtitle.textContent = 'Your latest completed sales';
        trendTitle.textContent = 'My Recent Sales';
        trendSubtitle.textContent = 'Your completed sales over the last 7 days';
        distributionTitle.textContent = 'Payment Methods';
        distributionSubtitle.textContent = 'How customers paid during the last 7 days';
    } else if (role === 'staff') {
        title.textContent = 'Staff Inventory Dashboard';
        subtitle.textContent = 'Priorities for receiving, counting, and keeping stock accurate';
        ['Active Products', 'Healthy Stock', 'Low Stock', 'Out of Stock'].forEach((label, index) => {
            if (statTitles[index]) statTitles[index].textContent = label;
        });
        ['Products in the catalog', 'Items above reorder level', 'Items at or below reorder level', 'Items needing immediate attention'].forEach((label, index) => {
            if (statChanges[index]) statChanges[index].textContent = label;
        });
        setPanelVisibility(['sales-trend', 'stock-distribution', 'recent-activity', 'supplier-frequency']);
        activityTitle.textContent = 'Recent Stock Changes';
        activitySubtitle.textContent = 'Latest receiving and stock adjustments';
        trendTitle.textContent = 'Stock Change Activity';
        trendSubtitle.textContent = 'Units received and released over the last 7 days';
        distributionTitle.textContent = 'Stock Health';
        distributionSubtitle.textContent = 'Active products compared with their reorder levels';
    } else {
        title.textContent = role === 'owner' ? 'Owner Dashboard' : (role === 'manager' ? 'Manager Dashboard' : 'Admin Dashboard');
        subtitle.textContent = 'System-wide sales, inventory, and operational overview';
        setPanelVisibility(['sales-trend', 'stock-distribution', 'product-value', 'recent-activity', 'supplier-frequency']);
        trendTitle.textContent = 'Sales Trends';
        trendSubtitle.textContent = 'Monthly sales performance';
        distributionTitle.textContent = 'Stock Distribution';
        distributionSubtitle.textContent = 'Products by status';
    }
}

async function loadCashierDashboard() {
    try {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);

        const { data, error } = await supabaseClient
            .from('pos_transactions')
            .select('total_amount, pos_transaction_items(quantity)')
            .eq('cashier_id', dashboardUserId)
            .eq('is_voided', false)
            .gte('transaction_datetime', start.toISOString())
            .lt('transaction_datetime', end.toISOString());
        if (error) throw error;

        const transactions = data || [];
        const sales = transactions.reduce((sum, item) => sum + Number(item.total_amount || 0), 0);
        const items = transactions.reduce((sum, transaction) => sum +
            (transaction.pos_transaction_items || []).reduce((itemSum, item) => itemSum + Number(item.quantity || 0), 0), 0);
        const average = transactions.length ? sales / transactions.length : 0;

        document.getElementById('total-products').textContent = formatCurrency(sales);
        document.getElementById('in-stock').textContent = transactions.length;
        document.getElementById('low-stock').textContent = items;
        document.getElementById('total-value').textContent = formatCurrency(average);
        await updateCashierAnalytics(start);
    } catch (error) {
        console.error('Error loading cashier dashboard:', error);
        showError('Failed to load your sales summary');
    }
}

async function loadDashboardStats() {
    try {
        const { count: totalProducts } = await supabaseClient
            .from('products')
            .select('*', { count: 'exact', head: true });
        const { count: activeProductCount } = await supabaseClient
            .from('products')
            .select('*', { count: 'exact', head: true })
            .eq('is_active', true);
        const { data: stockData, error: stockError } = await supabaseClient
            .from('inventory_stock')
            .select(`
                quantity,
                product:products(unit_price, selling_price, reorder_level, maximum_stock, is_active)
            `);
        
        if (stockError) {
            console.error('Error fetching stock data:', stockError);
            throw stockError;
        }
        
        console.log('Stock data loaded:', stockData);
        
        let inStock = 0;
        let lowStock = 0;
        let totalValue = 0;
        let outOfStock = 0;

        for (const item of stockData || []) {
            const quantity = item.quantity || 0;
    
            const status = getDashboardStockStatus(quantity, item.product);
            if (status === 'out_of_stock') {
                outOfStock++;
            } else if (status === 'in_stock') {
                inStock++;
            } else {
                lowStock++;
            }

            const unitPrice = item.product?.unit_price || 0;
            totalValue += quantity * unitPrice;
        }
        
        console.log('Dashboard stats:', { totalProducts, inStock, lowStock, totalValue });
        animateValue('total-products', 0, dashboardRole === 'staff' ? (activeProductCount || 0) : (totalProducts || 0), 1000);
        animateValue('in-stock', 0, inStock, 1000);
        animateValue('low-stock', 0, lowStock, 1000);
        animateValue('total-value', 0, dashboardRole === 'staff' ? outOfStock : totalValue, 1000, dashboardRole !== 'staff');
        if (dashboardRole === 'staff') {
            await Promise.all([
                updateStockDistributionChart(),
                updateStaffMovementTrend(),
                updateSupplierFrequencyChart()
            ]);
        } else {
            await updateAllCharts();
        }
        
    } catch (error) {
        console.error('Error loading dashboard stats:', error);
        showError('Failed to load dashboard statistics');
    }
}

async function loadRecentActivity() {
    if (dashboardRole === 'staff') {
        return loadRecentStockMovements();
    }

    try {
        let query = supabaseClient
            .from('pos_transactions')
            .select(`
                transaction_id,
                transaction_datetime,
                total_amount,
                payment_method,
                is_voided,
                pos_transaction_items(quantity)
            `)
            .eq('is_voided', false);

        if (dashboardRole === 'cashier' && dashboardUserId) {
            query = query.eq('cashier_id', dashboardUserId);
        }

        const { data: transactions, error } = await query
            .order('transaction_datetime', { ascending: false })
            .limit(8);
        
        if (error) {
            console.error('Error loading recent POS activity:', error);
            throw error;
        }

        const activityContainer = document.getElementById('recent-activity');

        if (!transactions || transactions.length === 0) {
            activityContainer.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-inbox"></i>
                    <p>No recent POS sales</p>
                </div>
            `;
            return;
        }

        activityContainer.innerHTML = transactions.map(transaction => {
            const date = new Date(transaction.transaction_datetime);
            const timeAgo = getTimeAgo(date);
            const itemCount = Array.isArray(transaction.pos_transaction_items)
                ? transaction.pos_transaction_items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
                : 0;

            return `
                <div class="activity-item">
                    <div class="activity-icon inbound">
                        <i class="fas fa-cash-register"></i>
                    </div>
                    <div class="activity-content">
                        <div class="activity-title">POS Sale</div>
                        <div class="activity-details">
                            ${formatCurrency(Number(transaction.total_amount || 0))} • ${itemCount} items • ${transaction.payment_method || 'cash'}
                        </div>
                    </div>
                    <div class="activity-time">${timeAgo}</div>
                </div>
            `;
        }).join('');

    } catch (error) {
        console.error('Error loading recent activity:', error);
    }
}

async function loadRecentStockMovements() {
    const activityContainer = document.getElementById('recent-activity');
    try {
        const { data, error } = await supabaseClient
            .from('stock_movements')
            .select('movement_type, quantity_change, movement_date, product:products(product_name, product_code)')
            .order('movement_date', { ascending: false })
            .limit(10);
        if (error) throw error;

        if (!data?.length) {
            activityContainer.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>No recent stock changes</p></div>';
            return;
        }

        activityContainer.innerHTML = data.map(movement => `
            <div class="activity-item">
                <div class="activity-icon ${movement.movement_type === 'inbound' ? 'inbound' : 'outbound'}">
                    <i class="fas fa-${movement.movement_type === 'inbound' ? 'arrow-down' : 'arrow-up'}"></i>
                </div>
                <div class="activity-content">
                    <div class="activity-title">${movement.product?.product_name || 'Inventory item'}</div>
                    <div class="activity-details">${movement.movement_type || 'movement'} • ${Math.abs(Number(movement.quantity_change || 0))} units</div>
                </div>
                <div class="activity-time">${getTimeAgo(new Date(movement.movement_date))}</div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading recent stock movements:', error);
        activityContainer.innerHTML = '<div class="empty-state"><p>Recent movements could not be loaded</p></div>';
    }
}

async function loadLowStockAlerts() {
    try {
        const { data: stockItems, error } = await supabaseClient
            .from('inventory_stock')
            .select(`
                stock_id,
                quantity,
                product:products(product_id, product_name, product_code, unit_of_measure, reorder_level, maximum_stock, is_active)
            `);
        if (error) throw error;

        const attentionItems = (stockItems || [])
            .map(item => ({ ...item, alertType: getDashboardStockStatus(item.quantity, item.product) }))
            .filter(item => item.product?.is_active !== false && item.alertType !== 'in_stock')
            .sort((a, b) => Number(a.quantity || 0) - Number(b.quantity || 0));
        const severityOrder = { out_of_stock: 0, critical: 1, low_stock: 2 };
        const allAlerts = attentionItems
            .sort((a, b) => severityOrder[a.alertType] - severityOrder[b.alertType] || Number(a.quantity || 0) - Number(b.quantity || 0));

        const alertsContainer = document.getElementById('low-stock-alerts');
        const alertCount = document.getElementById('alert-count');

        alertCount.textContent = attentionItems.length;

        if (allAlerts.length === 0) {
            alertsContainer.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-check-circle"></i>
                    <p>All products are well stocked</p>
                </div>
            `;
            return;
        }

        alertsContainer.innerHTML = allAlerts.map(item => {
            const isUrgent = item.alertType === 'out_of_stock' || item.alertType === 'critical';
            const iconClass = item.alertType === 'out_of_stock' ? 'fas fa-times-circle' : 'fas fa-exclamation-triangle';
            const iconBgColor = isUrgent ? '#fee2e2' : '#fef3c7';
            const iconColor = isUrgent ? 'var(--danger)' : 'var(--warning)';
            const unit = item.product?.unit_of_measure || 'units';
            const alertText = item.alertType === 'out_of_stock'
                ? 'Out of stock!'
                : `${item.alertType === 'critical' ? 'Critical' : 'Low stock'}: only ${item.quantity} ${unit} remaining`;

            return `
                <div class="alert-item">
                    <div class="alert-icon" style="background-color: ${iconBgColor}; color: ${iconColor};">
                        <i class="${iconClass}"></i>
                    </div>
                    <div class="alert-content">
                        <div class="alert-product">${item.product?.product_name || 'Unknown'}</div>
                        <div class="alert-details">
                            Code: ${item.product?.product_code || 'N/A'} • ${alertText}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

    } catch (error) {
        console.error('Error loading low stock alerts:', error);
    }
}

function initializeCharts() {
    const salesCtx = document.getElementById('salesTrendChart');
    if (salesCtx) {
        salesTrendChart = new Chart(salesCtx, {
            type: 'line',
            data: {
                labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
                datasets: [{
                    label: 'POS Sales Revenue',
                    data: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                    borderColor: '#2563eb',
                    backgroundColor: 'rgba(37, 99, 235, 0.1)',
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top'
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                if (dashboardRole === 'staff') {
                                    return context.dataset.label + ': ' + Number(context.parsed.y || 0).toLocaleString() + ' units';
                                }
                                return context.dataset.label + ': ' + formatCurrency(context.parsed.y || 0);
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: '#f3f4f6'
                        },
                        ticks: {
                            callback: function(value) {
                                if (dashboardRole === 'staff') return Number(value).toLocaleString();
                                return '₱' + Number(value).toLocaleString();
                            }
                        }
                    },
                    x: {
                        grid: {
                            display: false
                        }
                    }
                }
            }
        });
    }
    
    const stockCtx = document.getElementById('stockDistributionChart');
    if (stockCtx) {
        stockDistributionChart = new Chart(stockCtx, {
            type: 'doughnut',
            data: {
                labels: ['In Stock', 'Low Stock', 'Out of Stock'],
                datasets: [{
                    data: [0, 0, 0],
                    backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const label = context.label || '';
                                const value = context.parsed || 0;
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                                return label + ': ' + value + ' (' + percentage + '%)';
                            }
                        }
                    }
                }
            }
        });
    }
    
    // Simplified category chart - now shows top products by value instead
    const categoryCtx = document.getElementById('categoryChart');
    if (categoryCtx) {
        categoryChart = new Chart(categoryCtx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: 'Total Value',
                    data: [],
                    backgroundColor: '#2563eb',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return 'Value: ₱' + context.parsed.x.toLocaleString('en-PH', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2
                                });
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        grid: {
                            color: '#f3f4f6'
                        },
                        ticks: {
                            callback: function(value) {
                                return '₱' + value.toLocaleString();
                            }
                        }
                    },
                    y: {
                        grid: {
                            display: false
                        }
                    }
                }
            }
        });
    }

    const supplierCtx = document.getElementById('supplierFrequencyChart');
    if (supplierCtx) {
        supplierFrequencyChart = new Chart(supplierCtx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: 'Distinct receipts',
                    data: [],
                    backgroundColor: '#10b981',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: context => `${context.parsed.x} distinct receipt${context.parsed.x === 1 ? '' : 's'}`
                        }
                    }
                },
                scales: {
                    x: { beginAtZero: true, ticks: { precision: 0 } },
                    y: { grid: { display: false } }
                }
            }
        });
    }
}

function getLastSevenDays() {
    const days = [];
    for (let offset = 6; offset >= 0; offset--) {
        const date = new Date();
        date.setHours(0, 0, 0, 0);
        date.setDate(date.getDate() - offset);
        days.push(date);
    }
    return days;
}

function dateKey(value) {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function updateCashierAnalytics() {
    try {
        const days = getLastSevenDays();
        const rangeStart = days[0].toISOString();
        const rangeEnd = new Date(days[6]);
        rangeEnd.setDate(rangeEnd.getDate() + 1);

        const { data, error } = await supabaseClient
            .from('pos_transactions')
            .select('transaction_datetime, total_amount, payment_method')
            .eq('cashier_id', dashboardUserId)
            .eq('is_voided', false)
            .gte('transaction_datetime', rangeStart)
            .lt('transaction_datetime', rangeEnd.toISOString());
        if (error) throw error;

        const salesByDay = Object.fromEntries(days.map(day => [dateKey(day), 0]));
        const payments = {};
        (data || []).forEach(transaction => {
            const key = dateKey(transaction.transaction_datetime);
            if (key in salesByDay) salesByDay[key] += Number(transaction.total_amount || 0);
            const method = String(transaction.payment_method || 'Other').trim().toLowerCase();
            const label = method ? method.charAt(0).toUpperCase() + method.slice(1) : 'Other';
            payments[label] = (payments[label] || 0) + 1;
        });

        if (salesTrendChart) {
            salesTrendChart.data.labels = days.map(day => day.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }));
            salesTrendChart.data.datasets = [{
                label: 'My Sales',
                data: Object.values(salesByDay),
                borderColor: '#2563eb',
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                tension: 0.35,
                fill: true
            }];
            salesTrendChart.update();
        }

        if (stockDistributionChart) {
            const labels = Object.keys(payments);
            stockDistributionChart.data.labels = labels.length ? labels : ['No sales yet'];
            stockDistributionChart.data.datasets[0].data = labels.length ? Object.values(payments) : [1];
            stockDistributionChart.data.datasets[0].backgroundColor = labels.length
                ? ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#64748b']
                : ['#e5e7eb'];
            stockDistributionChart.update();
        }
    } catch (error) {
        console.error('Error loading cashier analytics:', error);
    }
}

async function updateStaffMovementTrend() {
    try {
        const days = getLastSevenDays();
        const rangeStart = days[0].toISOString();
        const rangeEnd = new Date(days[6]);
        rangeEnd.setDate(rangeEnd.getDate() + 1);
        const { data, error } = await supabaseClient
            .from('stock_movements')
            .select('movement_date, quantity_change')
            .gte('movement_date', rangeStart)
            .lt('movement_date', rangeEnd.toISOString());
        if (error) throw error;

        const received = Object.fromEntries(days.map(day => [dateKey(day), 0]));
        const released = Object.fromEntries(days.map(day => [dateKey(day), 0]));
        (data || []).forEach(movement => {
            const key = dateKey(movement.movement_date);
            const change = Number(movement.quantity_change || 0);
            if (change > 0 && key in received) received[key] += change;
            if (change < 0 && key in released) released[key] += Math.abs(change);
        });

        if (salesTrendChart) {
            salesTrendChart.data.labels = days.map(day => day.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }));
            salesTrendChart.data.datasets = [
                { label: 'Received', data: Object.values(received), borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.12)', tension: 0.3, fill: false },
                { label: 'Released', data: Object.values(released), borderColor: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.12)', tension: 0.3, fill: false }
            ];
            salesTrendChart.update();
        }
    } catch (error) {
        console.error('Error loading staff movement analytics:', error);
    }
}

async function updateAllCharts() {
    try {
        console.log('Updating all charts with real data...');
        await updateStockDistributionChart();
        await updateSalesTrendChart();
        await updateProductValueChart();
        await updateSupplierFrequencyChart();
        
    } catch (error) {
        console.error('Error updating charts:', error);
    }
}

async function updateSupplierFrequencyChart() {
    if (!supplierFrequencyChart) return;

    try {
        const currentYear = new Date().getFullYear();
        const { data, error } = await supabaseClient
            .from('vlm_extractions')
            .select('image_id, supplier_name, created_at')
            .not('supplier_name', 'is', null)
            .eq('extraction_status', 'success')
            .gte('created_at', new Date(currentYear, 0, 1).toISOString())
            .lte('created_at', new Date(currentYear, 11, 31, 23, 59, 59, 999).toISOString())
            .order('created_at', { ascending: false });
        if (error) throw error;

        const receipts = new Map();
        (data || []).forEach((row, index) => {
            const name = String(row.supplier_name || '').trim();
            if (!name) return;
            const receiptKey = row.image_id
                ? `image:${row.image_id}`
                : `record:${row.created_at || index}:${name.toLocaleUpperCase()}`;
            if (!receipts.has(receiptKey)) receipts.set(receiptKey, row);
        });

        const suppliers = new Map();
        receipts.forEach(row => {
            const name = String(row.supplier_name).trim();
            const key = name.toLocaleUpperCase();
            const supplier = suppliers.get(key) || { name: key, receipts: 0 };
            supplier.receipts += 1;
            suppliers.set(key, supplier);
        });

        const topSuppliers = [...suppliers.values()]
            .sort((a, b) => b.receipts - a.receipts || a.name.localeCompare(b.name))
            .slice(0, 5);
        supplierFrequencyChart.data.labels = topSuppliers.length
            ? topSuppliers.map(supplier => supplier.name)
            : ['No supplier receipts yet'];
        supplierFrequencyChart.data.datasets[0].data = topSuppliers.length
            ? topSuppliers.map(supplier => supplier.receipts)
            : [0];
        supplierFrequencyChart.update();

        const subtitle = document.getElementById('supplier-frequency-subtitle');
        if (subtitle) {
            subtitle.textContent = topSuppliers.length
                ? `Top suppliers by distinct receipts received in ${currentYear}`
                : `No supplier receipts recorded in ${currentYear}`;
        }
    } catch (error) {
        console.error('Error updating supplier frequency chart:', error);
        const subtitle = document.getElementById('supplier-frequency-subtitle');
        if (subtitle) subtitle.textContent = 'Supplier analytics could not be loaded';
    }
}

async function updateStockDistributionChart() {
    try {
        const { data: stockData, error } = await supabaseClient
            .from('inventory_stock')
            .select('quantity, product:products(reorder_level, maximum_stock, is_active)');
        
        if (error) throw error;
        
        let inStock = 0;
        let lowStock = 0;
        let outOfStock = 0;
        
        stockData?.forEach(item => {
            if (item.product?.is_active === false) return;
            const quantity = Number(item.quantity || 0);
            const status = getDashboardStockStatus(quantity, item.product);
            if (status === 'in_stock') inStock++;
            else if (status === 'out_of_stock') outOfStock++;
            else lowStock++;
        });
        
        console.log('Stock distribution:', { inStock, lowStock, outOfStock });
        
        if (stockDistributionChart) {
            stockDistributionChart.data.datasets[0].data = [inStock, lowStock, outOfStock];
            stockDistributionChart.update();
        }
    } catch (error) {
        console.error('Error updating stock distribution chart:', error);
    }
}

async function updateSalesTrendChart() {
    try {
        const currentYear = new Date().getFullYear();
        const startDate = new Date(currentYear, 0, 1).toISOString();
        const endDate = new Date(currentYear, 11, 31, 23, 59, 59).toISOString();

        const { data: transactions, error } = await supabaseClient
            .from('pos_transactions')
            .select('transaction_datetime, total_amount')
            .eq('is_voided', false)
            .gte('transaction_datetime', startDate)
            .lte('transaction_datetime', endDate);

        if (error) throw error;

        const monthlyData = Array(12).fill(0);
        transactions?.forEach(transaction => {
            const date = new Date(transaction.transaction_datetime);
            const month = date.getMonth();
            monthlyData[month] += Number(transaction.total_amount || 0);
        });

        console.log('Sales trend data (POS sales by month):', monthlyData);

        if (salesTrendChart) {
            salesTrendChart.data.datasets[0].data = monthlyData;
            salesTrendChart.update();
        }
    } catch (error) {
        console.error('Error updating sales trend chart:', error);
    }
}

async function updateProductValueChart() {
    try {
        const { data: products, error } = await supabaseClient
            .from('products')
            .select(`
                product_name,
                selling_price,
                inventory_stock!inventory_stock_product_id_fkey(quantity)
            `);
        
        if (error) throw error;
        
        console.log('Products loaded for value chart:', products?.length);
        const productValues = products?.map(p => {
            const inventory = Array.isArray(p.inventory_stock) 
                ? p.inventory_stock[0] 
                : p.inventory_stock;
            const quantity = inventory?.quantity || 0;
            const value = (p.selling_price || 0) * quantity;
            return {
                name: p.product_name,
                value: value
            };
        }).filter(p => p.value > 0) || []; 
        
        productValues.sort((a, b) => b.value - a.value);
        const top5 = productValues.slice(0, 5);
        
        console.log('Top 5 products by value:', top5);
        
        if (categoryChart) {
            if (top5.length > 0) {
                categoryChart.data.labels = top5.map(p => p.name);
                categoryChart.data.datasets[0].data = top5.map(p => p.value);
            } else {
                categoryChart.data.labels = ['No Data'];
                categoryChart.data.datasets[0].data = [0];
            }
            categoryChart.update();
        }
    } catch (error) {
        console.error('Error updating product value chart:', error);
    }
}

function setupRealtimeSubscriptions() {
    supabaseClient
        .channel('stock_movements_changes')
        .on('postgres_changes', 
            { event: '*', schema: 'public', table: 'stock_movements' },
            (payload) => {
                console.log('Stock movement change:', payload);
                loadDashboardStats();
                loadRecentActivity();
            }
        )
        .subscribe();

    supabaseClient
        .channel('inventory_stock_changes')
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'inventory_stock' },
            (payload) => {
                console.log('Inventory stock change:', payload);
                loadDashboardStats();
                loadLowStockAlerts();
                showLowStockNotifications();
            }
        )
        .subscribe();

    supabaseClient
        .channel('supplier_extraction_changes')
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'vlm_extractions' },
            () => updateSupplierFrequencyChart()
        )
        .subscribe();
}

function animateValue(id, start, end, duration, isCurrency = false) {
    const element = document.getElementById(id);
    if (!element) return;
    
    const range = end - start;
    const increment = range / (duration / 16);
    let current = start;
    
    const timer = setInterval(() => {
        current += increment;
        if ((increment > 0 && current >= end) || (increment < 0 && current <= end)) {
            current = end;
            clearInterval(timer);
        }
        
        if (isCurrency) {
            element.textContent = formatCurrency(Math.round(current));
        } else {
            element.textContent = Math.round(current);
        }
    }, 16);
}

function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    
    const intervals = {
        year: 31536000,
        month: 2592000,
        week: 604800,
        day: 86400,
        hour: 3600,
        minute: 60
    };
    
    for (const [unit, secondsInUnit] of Object.entries(intervals)) {
        const interval = Math.floor(seconds / secondsInUnit);
        if (interval >= 1) {
            return `${interval} ${unit}${interval !== 1 ? 's' : ''} ago`;
        }
    }
    
    return 'just now';
}

function formatCurrency(value) {
    return '₱' + value.toLocaleString('en-PH', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

async function showLowStockNotifications() {
    try {
        const { data: stockItems, error } = await supabaseClient
            .from('inventory_stock')
            .select(`
                quantity,
                product:products(product_name, reorder_level, maximum_stock, is_active)
            `);
        if (error) throw error;
        const attentionItems = (stockItems || [])
            .map(item => ({ ...item, alertType: getDashboardStockStatus(item.quantity, item.product) }))
            .filter(item => item.product?.is_active !== false && item.alertType !== 'in_stock');
        const outOfStockItems = attentionItems.filter(item => item.alertType === 'out_of_stock');
        const criticalItems = attentionItems.filter(item => item.alertType === 'critical');
        const lowStockItems = attentionItems.filter(item => item.alertType === 'low_stock');

        if (outOfStockItems.length > 0) {
            showToast(`Out of stock: ${formatProductNames(outOfStockItems)}.`, 'error');
        }
        if (criticalItems.length > 0) {
            showToast(`Critical stock: ${formatProductNames(criticalItems)}.`, 'error');
        }
        if (lowStockItems.length > 0) {
            showToast(`Low stock: ${formatProductNames(lowStockItems)}.`, 'warning');
        }
    } catch (error) {
        console.error('Error showing low stock notifications:', error);
    }
}

function showError(message) {
    console.error(message);
}
