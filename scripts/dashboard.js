let salesTrendChart = null;
let stockDistributionChart = null;
let categoryChart = null;

document.addEventListener('DOMContentLoaded', async () => {
    const session = await window.authHelpers.requireAuth();
    if (!session) return;
    
    // Check role access - only admin and manager can access dashboard
    const hasAccess = await window.authHelpers.requireRole(['admin', 'manager']);
    if (!hasAccess) return;
    
    initializeCharts();
    await loadDashboardStats();
    await loadRecentActivity();
    await loadLowStockAlerts();
    await showLowStockNotifications();
    setupRealtimeSubscriptions();
});

async function loadDashboardStats() {
    try {
        const { count: totalProducts } = await supabaseClient
            .from('products')
            .select('*', { count: 'exact', head: true });
        const { data: stockData, error: stockError } = await supabaseClient
            .from('inventory_stock')
            .select(`
                quantity,
                product:products(unit_price)
            `);
        
        if (stockError) {
            console.error('Error fetching stock data:', stockError);
            throw stockError;
        }
        
        console.log('Stock data loaded:', stockData);
        
        let inStock = 0;
        let lowStock = 0;
        let totalValue = 0;

        for (const item of stockData || []) {
            const quantity = item.quantity || 0;
    
            if (quantity >= 10) {
                inStock++;
            } else if (quantity > 0 && quantity < 10) {
                lowStock++;
            }

            const unitPrice = item.product?.unit_price || 0;
            totalValue += quantity * unitPrice;
        }
        
        console.log('Dashboard stats:', { totalProducts, inStock, lowStock, totalValue });
        animateValue('total-products', 0, totalProducts || 0, 1000);
        animateValue('in-stock', 0, inStock, 1000);
        animateValue('low-stock', 0, lowStock, 1000);
        animateValue('total-value', 0, totalValue, 1000, true);
        await updateAllCharts();
        
    } catch (error) {
        console.error('Error loading dashboard stats:', error);
        showError('Failed to load dashboard statistics');
    }
}

async function loadRecentActivity() {
    try {
        const { data: movements, error } = await supabaseClient
            .from('stock_movements')
            .select(`
                movement_id,
                product_id,
                movement_type,
                quantity_change,
                movement_date,
                notes,
                product:products(product_name)
            `)
            .order('movement_date', { ascending: false })
            .limit(8);
        
        if (error) {
            console.error('Error loading recent activity:', error);
            throw error;
        }
        
        const activityContainer = document.getElementById('recent-activity');
        
        if (!movements || movements.length === 0) {
            activityContainer.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-inbox"></i>
                    <p>No recent activity</p>
                </div>
            `;
            return;
        }
        
        activityContainer.innerHTML = movements.map(movement => {
            const date = new Date(movement.movement_date);
            const timeAgo = getTimeAgo(date);
            const icon = movement.movement_type === 'inbound' ? 'arrow-down' : 'arrow-up';
            const iconClass = movement.movement_type === 'inbound' ? 'inbound' : 'outbound';
            
            return `
                <div class="activity-item">
                    <div class="activity-icon ${iconClass}">
                        <i class="fas fa-${icon}"></i>
                    </div>
                    <div class="activity-content">
                        <div class="activity-title">${movement.product?.product_name || 'Unknown'}</div>
                        <div class="activity-details">
                            ${movement.quantity_change > 0 ? '+' : ''}${movement.quantity_change} units
                            ${movement.notes ? ' • ' + movement.notes : ''}
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

async function loadLowStockAlerts() {
    try {
        const { data: lowStockItems, error: lowError } = await supabaseClient
            .from('inventory_stock')
            .select(`
                stock_id,
                quantity,
                product:products(product_id, product_name, product_code)
            `)
            .lt('quantity', 10)
            .gt('quantity', 0)
            .limit(3);

        if (lowError) {
            console.error('Error loading low stock items:', lowError);
            throw lowError;
        }

        const { data: outOfStockItems, error: outError } = await supabaseClient
            .from('inventory_stock')
            .select(`
                stock_id,
                quantity,
                product:products(product_id, product_name, product_code)
            `)
            .eq('quantity', 0)
            .limit(2);

        if (outError) {
            console.error('Error loading out of stock items:', outError);
            throw outError;
        }

        const allAlerts = [
            ...(outOfStockItems || []).map(item => ({ ...item, alertType: 'out_of_stock' })),
            ...(lowStockItems || []).map(item => ({ ...item, alertType: 'low_stock' }))
        ];

        const alertsContainer = document.getElementById('low-stock-alerts');
        const alertCount = document.getElementById('alert-count');

        alertCount.textContent = allAlerts.length;

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
            const isOutOfStock = item.alertType === 'out_of_stock';
            const iconClass = isOutOfStock ? 'fas fa-times-circle' : 'fas fa-exclamation-triangle';
            const iconBgColor = isOutOfStock ? '#fee2e2' : '#fef3c7';
            const iconColor = isOutOfStock ? 'var(--danger)' : 'var(--warning)';
            const alertText = isOutOfStock ? 'Out of stock!' : `Only ${item.quantity} units remaining`;

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
                    label: 'Outbound Transactions',
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
                                return context.dataset.label + ': ' + context.parsed.y + ' items';
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
                                return value.toLocaleString();
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
}

async function updateAllCharts() {
    try {
        console.log('Updating all charts with real data...');
        await updateStockDistributionChart();
        await updateSalesTrendChart();
        await updateProductValueChart();
        
    } catch (error) {
        console.error('Error updating charts:', error);
    }
}

async function updateStockDistributionChart() {
    try {
        const { data: stockData, error } = await supabaseClient
            .from('inventory_stock')
            .select('quantity');
        
        if (error) throw error;
        
        let inStock = 0;
        let lowStock = 0;
        let outOfStock = 0;
        
        // Updated to use single quantity field
        stockData?.forEach(item => {
            const quantity = item.quantity || 0;
            if (quantity >= 10) inStock++;
            else if (quantity > 0) lowStock++;
            else outOfStock++;
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
        
        const { data: movements, error } = await supabaseClient
            .from('stock_movements')
            .select('movement_date, quantity_change')
            .eq('movement_type', 'outbound')
            .gte('movement_date', startDate)
            .lte('movement_date', endDate);
        
        if (error) throw error;
        const monthlyData = Array(12).fill(0);
        movements?.forEach(movement => {
            const date = new Date(movement.movement_date);
            const month = date.getMonth();
            monthlyData[month] += Math.abs(movement.quantity_change);
        });
        
        console.log('Sales trend data (outbound by month):', monthlyData);
        
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
            }
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
        // Updated to use single quantity field
        const { data: lowStockItems } = await supabaseClient
            .from('inventory_stock')
            .select(`
                quantity,
                product:products(product_name)
            `)
            .lt('quantity', 10)
            .gt('quantity', 0)
            .limit(3);

        const { data: outOfStockItems } = await supabaseClient
            .from('inventory_stock')
            .select(`
                quantity,
                product:products(product_name)
            `)
            .eq('quantity', 0)
            .limit(3);

        if (outOfStockItems && outOfStockItems.length > 0) {
            const notificationMessage = `Out of stock alert: ${outOfStockItems.length} item${outOfStockItems.length > 1 ? 's' : ''} ${outOfStockItems.length === 1 ? 'is' : 'are'} out of stock!`;
            showToast(notificationMessage, 'error');
        } else if (lowStockItems && lowStockItems.length > 0) {
            const notificationMessage = `Low stock alert: ${lowStockItems.length} item${lowStockItems.length > 1 ? 's' : ''} need${lowStockItems.length === 1 ? 's' : ''} attention.`;
            showToast(notificationMessage, 'warning');
        }
    } catch (error) {
        console.error('Error showing low stock notifications:', error);
    }
}

function showError(message) {
    console.error(message);
}
