let overallPaymentsChart;
let overallMovementsChart;
let overallLoading = false;

function initializeOverallDashboard() {
    if (!['admin'].includes(dashboardRole)) return;
    document.getElementById('overall-dashboard').hidden = false;
    overallPaymentsChart = new Chart(document.getElementById('overallPaymentsChart'), {
        type: 'doughnut', data: { labels: [], datasets: [{ data: [], backgroundColor: ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6'] }] },
        options: { responsive: true, maintainAspectRatio: false }
    });
    overallMovementsChart = new Chart(document.getElementById('overallMovementsChart'), {
        type: 'line', data: { labels: [], datasets: [] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
    });
    // Refresh completed sales and voids even when they do not trigger a stock event.
    supabaseClient.channel('overall_sales_changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pos_transactions' }, () => loadOverallDashboard())
        .subscribe();
    window.setInterval(loadOverallDashboard, 120000);
}

function summarizeOverallSales(transactions, startOfToday) {
    const today = transactions.filter(transaction => new Date(transaction.transaction_datetime) >= startOfToday);
    const sales = today.reduce((sum, transaction) => sum + Number(transaction.total_amount || 0), 0);
    const units = today.reduce((sum, transaction) => sum + (transaction.pos_transaction_items || [])
        .reduce((count, item) => count + Number(item.quantity || 0), 0), 0);
    const payments = {};
    for (const transaction of transactions) {
        const label = transaction.payment_method === 'bank_transfer' ? 'QR / E-wallet' : transaction.payment_method || 'Other';
        payments[label] = (payments[label] || 0) + 1;
    }
    return { sales, units, transactions: today.length, average: today.length ? sales / today.length : 0, payments };
}

async function loadOverallDashboard() {
    if (!['admin'].includes(dashboardRole) || overallLoading) return;
    overallLoading = true;
    const errorDisplay = document.getElementById('overall-error');
    errorDisplay.textContent = '';
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const start = new Date(today);
        start.setDate(start.getDate() - 6);
        const end = new Date(today);
        end.setDate(end.getDate() + 1);
        // Page through sales so busy stores are not limited to the API's first page.
        const transactions = [];
        for (let offset = 0; ; offset += 500) {
            const { data, error } = await supabaseClient.from('pos_transactions')
                .select('transaction_id, transaction_datetime, total_amount, payment_method, pos_transaction_items(quantity)')
                .eq('is_voided', false).eq('is_active', true)
                .gte('transaction_datetime', start.toISOString()).lt('transaction_datetime', end.toISOString())
                .order('transaction_id').range(offset, offset + 499);
            if (error) throw error;
            transactions.push(...(data || []));
            if (!data || data.length < 500) break;
        }
        const summary = summarizeOverallSales(transactions, today);
        for (const key of ['sales', 'transactions', 'units', 'average']) {
            document.getElementById(`overall-${key}`).textContent = ['sales', 'average'].includes(key)
                ? formatCurrency(summary[key]) : summary[key].toLocaleString();
        }
        overallPaymentsChart.data.labels = Object.keys(summary.payments);
        overallPaymentsChart.data.datasets[0].data = Object.values(summary.payments);
        overallPaymentsChart.update();
        document.getElementById('overall-payments-empty').hidden = transactions.length > 0;
        let out = 0;
        for (let offset = 0; ; offset += 500) {
            const { data, error } = await supabaseClient.from('products')
                .select('product_id, inventory_stock!inventory_stock_product_id_fkey(quantity)')
                .eq('is_active', true).order('product_id').range(offset, offset + 499);
            if (error) throw error;
            out += (data || []).filter(product => {
                const stock = Array.isArray(product.inventory_stock) ? product.inventory_stock : [product.inventory_stock];
                return stock.reduce((sum, row) => sum + Number(row?.quantity || 0), 0) <= 0;
            }).length;
            if (!data || data.length < 500) break;
        }
        document.getElementById('overall-out').textContent = out.toLocaleString();
        await Promise.all([updateStaffMovementTrend(overallMovementsChart), loadRecentStockMovements('overall-stock-activity')]);
    } catch (error) {
        console.error('Unable to refresh overall dashboard:', error);
        errorDisplay.textContent = 'Some overview metrics could not be refreshed. Displayed values may be outdated.';
    } finally {
        overallLoading = false;
    }
}
