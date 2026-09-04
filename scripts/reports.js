console.log('=== PROFESSIONAL REPORTS SCRIPT LOADING ===');
let reportsRole = 'guest';
let reportsUserId = null;

document.addEventListener('DOMContentLoaded', async function() {
    console.log('=== DOM CONTENT LOADED ===');
    
    // Require authentication and role check
    await window.authHelpers.requireAuth();
    const hasAccess = await window.authHelpers.requireRole(['owner', 'admin', 'manager', 'cashier', 'staff']);
    if (!hasAccess) return;
    reportsRole = await window.authHelpers.getUserRole();
    reportsUserId = (await window.authHelpers.getCurrentUser())?.id || null;
    configureReportsForRole();
    window.authHelpers.revealProtectedContent();
    
    // Check jsPDF library
    let jsPDFConstructor = null;
    if (window.jspdf && window.jspdf.jsPDF) {
        jsPDFConstructor = window.jspdf.jsPDF;
        console.log('✓ jsPDF found');
    } else if (window.jsPDF) {
        jsPDFConstructor = window.jsPDF;
        console.log('✓ jsPDF found');
    } else {
        console.error('✗ jsPDF NOT FOUND!');
        alert('PDF library failed to load. Please refresh the page.');
        return;
    }
    
    // Check Supabase
    if (!window.supabaseClient) {
        console.error('✗ Supabase client NOT initialized');
        alert('Database connection failed. Check config.js');
        return;
    }
    console.log('✓ Supabase client ready');
    
    // Get DOM elements
    const generateBtn = document.getElementById('generate-report-btn');
    const reportTypeSelect = document.getElementById('report-type');
    const dateFrom = document.getElementById('date-from');
    const dateTo = document.getElementById('date-to');
    const reportPreview = document.getElementById('report-preview');
    
    if (!generateBtn) {
        console.error('✗ Generate button not found!');
        return;
    }
    
    console.log('✓ DOM elements found');
    
    // Update preview when report type changes
    if (reportTypeSelect) {
        reportTypeSelect.addEventListener('change', function() {
            updateReportPreview();
        });
    }
    
    // Quick report cards
    document.querySelectorAll('.quick-report-card').forEach(card => {
        const selectQuickReport = function() {
            const type = this.getAttribute('data-type');
            if (reportTypeSelect) {
                reportTypeSelect.value = type;
                updateReportPreview();
            }
        };
        card.addEventListener('click', selectQuickReport);
        card.addEventListener('keydown', function(event) {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                selectQuickReport.call(this);
            }
        });
    });
    
    // Generate report button
    generateBtn.addEventListener('click', async function() {
        console.log('=== GENERATE BUTTON CLICKED ===');
        
        const reportType = reportTypeSelect?.value || 'complete';
        const fromDate = dateFrom?.value || '';
        const toDate = dateTo?.value || '';
        
        console.log('Report params:', { reportType, fromDate, toDate });
        
        const datedReports = ['movement', 'outbound-activity', 'sales-summary', 'product-sales', 'cashier-performance', 'voided-sales', 'cashier-sales', 'cashier-products', 'cashier-payments'];
        if (datedReports.includes(reportType) && (!fromDate || !toDate)) {
            alert('Please select both From and To dates for this report');
            return;
        }
        if (fromDate && toDate && fromDate > toDate) {
            alert('The From date cannot be later than the To date');
            return;
        }
        
        // Disable button
        generateBtn.disabled = true;
        generateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
        
        try {
            await generateReport(reportType, fromDate, toDate);
            showNotification('Report generated successfully!', 'success');
        } catch (error) {
            console.error('Error generating report:', error);
            showNotification('Failed to generate report: ' + error.message, 'error');
        } finally {
            generateBtn.disabled = false;
            generateBtn.innerHTML = '<i class="fas fa-download"></i> Generate & Download PDF';
        }
    });
    
    // Initial preview update
    updateReportPreview();
    
    console.log('=== INITIALIZATION COMPLETE ===');
});

function updateReportPreview() {
    const reportType = document.getElementById('report-type')?.value;
    const preview = document.getElementById('report-preview');
    
    if (!preview) return;
    
    const previews = {
        'cashier-sales': {
            icon: 'fa-cash-register',
            items: [
                { icon: 'fa-peso-sign', title: 'Sales Summary', desc: 'Your revenue, transaction count, items sold, and average sale' },
                { icon: 'fa-receipt', title: 'Transaction History', desc: 'Your transactions for the selected date range' },
                { icon: 'fa-credit-card', title: 'Payment Breakdown', desc: 'Cash, QR/e-wallet, and other payment totals' }
            ]
        },
        'cashier-products': {
            items: [
                { icon: 'fa-ranking-star', title: 'Your Product Ranking', desc: 'Products ranked from your own completed transactions' },
                { icon: 'fa-boxes-stacked', title: 'Units and Revenue', desc: 'Units sold and line sales for each product' },
                { icon: 'fa-chart-pie', title: 'Sales Contribution', desc: 'Each product’s share of your sales' }
            ]
        },
        'cashier-payments': {
            items: [
                { icon: 'fa-credit-card', title: 'Your Payment Breakdown', desc: 'Cash and QR/e-wallet totals from your completed transactions' },
                { icon: 'fa-tags', title: 'Your Discounts', desc: 'Discount totals and discount rate for the selected period' },
                { icon: 'fa-calendar-day', title: 'Daily Reconciliation', desc: 'Daily transaction count and collected sales totals' }
            ]
        },
        'complete': {
            icon: 'fa-file-alt',
            items: [
                {
                    icon: 'fa-file-alt',
                    title: 'Executive Summary',
                    desc: 'Total products, stock value, and key metrics'
                },
                {
                    icon: 'fa-table',
                    title: 'Complete Product Listing',
                    desc: 'All products with stock levels, prices, and values'
                },
                {
                    icon: 'fa-chart-pie',
                    title: 'Category Distribution',
                    desc: 'Breakdown of inventory by category'
                },
                {
                    icon: 'fa-clipboard-check',
                    title: 'Stock Status Summary',
                    desc: 'In stock, low stock, and out of stock counts'
                }
            ]
        },
        'low-stock': {
            icon: 'fa-exclamation-triangle',
            items: [
                {
                    icon: 'fa-exclamation-triangle',
                    title: 'Low Stock Alert Summary',
                    desc: 'Total items requiring attention'
                },
                {
                    icon: 'fa-list',
                    title: 'Priority Restock List',
                    desc: 'Products at or below their low-stock alert level'
                },
                {
                    icon: 'fa-calculator',
                    title: 'Restock Recommendations',
                    desc: 'Suggested quantities based on stock levels'
                },
                {
                    icon: 'fa-dollar-sign',
                    title: 'Estimated Restock Cost',
                    desc: 'Total investment needed to restock'
                }
            ]
        },
        'valuation': {
            icon: 'fa-dollar-sign',
            items: [
                {
                    icon: 'fa-money-bill-wave',
                    title: 'Total Inventory Valuation',
                    desc: 'Complete stock worth at cost price'
                },
                {
                    icon: 'fa-chart-line',
                    title: 'Potential Revenue',
                    desc: 'Total value at selling price'
                },
                {
                    icon: 'fa-percentage',
                    title: 'Potential Profit Margin',
                    desc: 'Difference between cost and selling value'
                },
                {
                    icon: 'fa-layer-group',
                    title: 'Category Value Breakdown',
                    desc: 'Valuation grouped by product category'
                }
            ]
        },
        'movement': {
            icon: 'fa-exchange-alt',
            items: [
                {
                    icon: 'fa-calendar-alt',
                    title: 'Date Range Summary',
                    desc: 'Total movements in selected period'
                },
                {
                    icon: 'fa-clipboard-list',
                    title: 'Transaction History',
                    desc: 'Detailed list of all stock changes'
                },
                {
                    icon: 'fa-arrow-up',
                    title: 'Stock Additions',
                    desc: 'Purchases, returns, and adjustments'
                },
                {
                    icon: 'fa-arrow-down',
                    title: 'Stock Reductions',
                    desc: 'Sales, damages, and outgoing adjustments'
                }
            ]
        },
        'sales-summary': {
            items: [
                { icon: 'fa-peso-sign', title: 'Sales KPIs', desc: 'Net sales, transaction count, units, average sale, tax, and discounts' },
                { icon: 'fa-calendar-day', title: 'Daily Sales Breakdown', desc: 'Revenue and transaction totals for every active sales day' },
                { icon: 'fa-credit-card', title: 'Payment Methods', desc: 'Cash and QR/e-wallet transaction totals' },
                { icon: 'fa-receipt', title: 'Transaction Detail', desc: 'Complete non-voided POS transaction register' }
            ]
        },
        'product-sales': {
            items: [
                { icon: 'fa-ranking-star', title: 'Best-selling Products', desc: 'Products ranked by sales revenue' },
                { icon: 'fa-boxes-stacked', title: 'Units Sold', desc: 'Quantity and transaction frequency per product' },
                { icon: 'fa-coins', title: 'Sales Contribution', desc: 'Revenue and percentage contribution per item' }
            ]
        },
        'voided-sales': {
            items: [
                { icon: 'fa-ban', title: 'Void Summary', desc: 'Voided transaction count and cancelled sales value' },
                { icon: 'fa-list-check', title: 'Void Register', desc: 'Transaction, date, payment method, amount, and reason' }
            ]
        },
        'cashier-performance': {
            items: [
                { icon: 'fa-users', title: 'Cashier Comparison', desc: 'Revenue, transaction count, units, discounts, and average sale by cashier' },
                { icon: 'fa-ranking-star', title: 'Performance Ranking', desc: 'Cashiers ranked by completed sales value' },
                { icon: 'fa-credit-card', title: 'Payment Activity', desc: 'Cash and QR/e-wallet totals handled by each cashier' }
            ]
        },
        'outbound-activity': {
            items: [
                { icon: 'fa-arrow-up-from-bracket', title: 'Stock Removal Summary', desc: 'Removal count, total units, and unique products' },
                { icon: 'fa-tags', title: 'Reason Breakdown', desc: 'Sales, returns, damage, transfers, and other removal reasons' },
                { icon: 'fa-clipboard-list', title: 'Dispatch Register', desc: 'Products, references, quantities, notes, and responsible users' }
            ]
        }
    };
    
    const previewData = previews[reportType] || previews['complete'];
    
    preview.innerHTML = previewData.items.map(item => `
        <div style="display: flex; align-items: start; gap: 12px;">
            <i class="fas ${item.icon}" style="color: var(--primary-color); margin-top: 2px;"></i>
            <div>
                <p style="font-size: 14px; font-weight: 500; margin-bottom: 4px;">${item.title}</p>
                <p style="font-size: 12px; color: var(--text-secondary);">${item.desc}</p>
            </div>
        </div>
    `).join('');
    
    console.log('Preview updated for:', reportType);
}

async function generateReport(reportType, fromDate, toDate) {
    console.log('=== GENERATING REPORT ===');
    console.log('Type:', reportType);
    
    try {
        switch (reportType) {
            case 'cashier-sales':
                await generateCashierSalesReport(fromDate, toDate);
                break;
            case 'complete':
                await generateCompleteInventoryReport();
                break;
            case 'low-stock':
                await generateLowStockReport();
                break;
            case 'valuation':
                await generateValuationReport();
                break;
            case 'movement':
                await generateMovementReport(fromDate, toDate);
                break;
            case 'sales-summary':
                await generateSalesSummaryReport(fromDate, toDate);
                break;
            case 'product-sales':
                await generateProductSalesReport(fromDate, toDate);
                break;
            case 'voided-sales':
                await generateVoidedSalesReport(fromDate, toDate);
                break;
            case 'cashier-performance':
                await generateCashierPerformanceReport(fromDate, toDate);
                break;
            case 'cashier-products':
                await generateProductSalesReport(fromDate, toDate, reportsUserId, 'My-Product-Sales');
                break;
            case 'cashier-payments':
                await generateCashierPaymentReport(fromDate, toDate);
                break;
            case 'outbound-activity':
                await generateOutboundActivityReport(fromDate, toDate);
                break;
            default:
                throw new Error('Invalid report type');
        }
    } catch (error) {
        console.error('Report generation error:', error);
        throw error;
    }
}

function configureReportsForRole() {
    const title = document.querySelector('.page-title');
    const subtitle = document.querySelector('.page-subtitle');
    const select = document.getElementById('report-type');

    if (reportsRole === 'cashier') {
        if (title) title.innerHTML = '<i class="fas fa-file-alt"></i> Cashier Sales Reports';
        if (subtitle) subtitle.textContent = 'Generate reports for your own sales and transactions';
        if (select) select.innerHTML = `
            <option value="cashier-sales">My Sales & Transaction Report</option>
            <option value="cashier-products">My Product Sales Performance</option>
            <option value="cashier-payments">My Payment & Discount Summary</option>`;
        renderRoleQuickReports([
            ['cashier-sales', 'fa-receipt', 'My Sales & Transactions', 'Revenue, transactions, items sold, and average sale'],
            ['cashier-products', 'fa-ranking-star', 'My Product Performance', 'Your best-selling products, units, and sales contribution'],
            ['cashier-payments', 'fa-credit-card', 'My Payment Summary', 'Cash, QR/e-wallet, discounts, tax, and daily reconciliation']
        ]);
    } else if (reportsRole === 'staff') {
        if (title) title.innerHTML = '<i class="fas fa-file-alt"></i> Inventory Reports';
        if (subtitle) subtitle.textContent = 'Generate inventory status, valuation, alerts, movement, and outbound reports';
        if (select) select.querySelector('optgroup[label="Sales Checkout"]')?.remove();
        renderRoleQuickReports([
            ['complete', 'fa-boxes-stacked', 'Current Inventory', 'Complete product and stock status listing'],
            ['low-stock', 'fa-triangle-exclamation', 'Low Stock Alert', 'Products requiring replenishment'],
            ['valuation', 'fa-coins', 'Inventory Valuation', 'Cost, selling value, and potential margin'],
            ['movement', 'fa-right-left', 'Stock Changes', 'History of stock added, removed, and corrected'],
            ['outbound-activity', 'fa-truck-ramp-box', 'Stock Removal Activity', 'Removed stock, reasons, products, and quantities']
        ]);
    } else {
        if (title) title.innerHTML = `<i class="fas fa-file-alt"></i> ${reportsRole === 'owner' ? 'Owner' : (reportsRole === 'manager' ? 'Manager' : 'Admin')} Reports`;
        if (subtitle) subtitle.textContent = 'Generate system-wide inventory, POS, cashier, and operational reports';
        renderRoleQuickReports([
            ['complete', 'fa-boxes-stacked', 'Current Inventory', 'Complete product and stock status listing'],
            ['low-stock', 'fa-triangle-exclamation', 'Low Stock Alert', 'Products requiring replenishment'],
            ['valuation', 'fa-coins', 'Inventory Valuation', 'Cost, selling value, and potential margin'],
            ['movement', 'fa-right-left', 'Stock Changes', 'History of stock added, removed, and corrected'],
            ['outbound-activity', 'fa-truck-ramp-box', 'Stock Removal Activity', 'Removed stock, reasons, products, and quantities'],
            ['sales-summary', 'fa-chart-line', 'POS Sales Summary', 'Revenue, payments, discounts, and daily totals'],
            ['product-sales', 'fa-ranking-star', 'Product Performance', 'Best sellers, units sold, and revenue'],
            ['cashier-performance', 'fa-users', 'Sales by Cashier', 'Compare cashier sales and transaction activity'],
            ['voided-sales', 'fa-ban', 'Voided Transactions', 'Cancelled sales value and void reasons']
        ]);
    }
}

function renderRoleQuickReports(reports) {
    const grid = document.getElementById('quick-report-grid');
    if (!grid) return;
    grid.innerHTML = reports.map(([type, icon, title, description]) => `
        <div class="quick-report-card" data-type="${type}" tabindex="0" role="button"
             aria-label="Select ${title} report"
             style="border: 1px solid var(--border-color); border-radius: 8px; padding: 20px; cursor: pointer; transition: all 0.2s;">
            <i class="fas ${icon}" style="font-size: 32px; color: var(--primary-color); margin-bottom: 12px;"></i>
            <h4 style="font-size: 14px; font-weight: 600; margin-bottom: 4px;">${title}</h4>
            <p style="font-size: 12px; color: var(--text-secondary);">${description}</p>
        </div>
    `).join('');
}

function reportPeriod(fromDate, toDate) {
    return {
        start: new Date(`${fromDate}T00:00:00`),
        end: new Date(`${toDate}T23:59:59.999`)
    };
}

async function fetchPosTransactions(fromDate, toDate, active, cashierId = null) {
    const { start, end } = reportPeriod(fromDate, toDate);
    let query = window.supabaseClient
        .from('pos_transactions')
        .select('cashier_id, transaction_number, transaction_datetime, subtotal, discount_amount, tax_amount, total_amount, payment_method, is_active, void_reason, pos_transaction_items(product_id, product_name, quantity, unit_price, line_total)')
        .eq('is_active', active)
        .gte('transaction_datetime', start.toISOString())
        .lte('transaction_datetime', end.toISOString());
    if (cashierId) query = query.eq('cashier_id', cashierId);
    const { data, error } = await query.order('transaction_datetime', { ascending: false });
    if (error) throw error;
    return { rows: data || [], start, end };
}

async function generateSalesSummaryReport(fromDate, toDate) {
    const { rows, start, end } = await fetchPosTransactions(fromDate, toDate, true);
    if (!rows.length) throw new Error('No completed POS sales found for the selected period');
    const sum = key => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
    const units = rows.reduce((total, row) => total + (row.pos_transaction_items || []).reduce((n, item) => n + Number(item.quantity || 0), 0), 0);
    const payments = {};
    const daily = {};
    rows.forEach(row => {
        const method = row.payment_method === 'bank_transfer' ? 'QR / E-wallet' : (row.payment_method || 'Cash');
        payments[method] ||= { count: 0, total: 0 };
        payments[method].count++;
        payments[method].total += Number(row.total_amount || 0);
        const day = new Date(row.transaction_datetime).toLocaleDateString('en-PH');
        daily[day] ||= { count: 0, total: 0 };
        daily[day].count++;
        daily[day].total += Number(row.total_amount || 0);
    });
    const doc = new (window.jspdf?.jsPDF || window.jsPDF)();
    let y = addReportHeader(doc, 'POS SALES SUMMARY REPORT', 20);
    y = addSectionHeader(doc, 'PERFORMANCE SUMMARY', y + 10);
    doc.autoTable({ startY: y, body: [
        ['Period', `${start.toLocaleDateString('en-PH')} - ${end.toLocaleDateString('en-PH')}`],
        ['Net Sales', formatPeso(sum('total_amount'))], ['Transactions', String(rows.length)],
        ['Units Sold', String(units)], ['Average Transaction', formatPeso(sum('total_amount') / rows.length)],
        ['Discounts Given', formatPeso(sum('discount_amount'))], ['Tax Collected', formatPeso(sum('tax_amount'))]
    ], theme: 'grid' });
    y = addSectionHeader(doc, 'DAILY SALES', doc.lastAutoTable.finalY + 12);
    doc.autoTable({ startY: y, head: [['Date', 'Transactions', 'Net Sales']], body: Object.entries(daily).map(([day, v]) => [day, String(v.count), formatPeso(v.total)]), theme: 'striped' });
    y = addSectionHeader(doc, 'PAYMENT METHOD BREAKDOWN', doc.lastAutoTable.finalY + 12);
    doc.autoTable({ startY: y, head: [['Payment Method', 'Transactions', 'Amount']], body: Object.entries(payments).map(([method, v]) => [method, String(v.count), formatPeso(v.total)]), theme: 'striped' });
    y = addSectionHeader(doc, 'TRANSACTION REGISTER', doc.lastAutoTable.finalY + 12);
    doc.autoTable({ startY: y, head: [['Transaction', 'Date/Time', 'Payment', 'Discount', 'Total']], body: rows.map(r => [r.transaction_number || 'N/A', new Date(r.transaction_datetime).toLocaleString('en-PH'), r.payment_method || 'cash', formatPeso(Number(r.discount_amount || 0)), formatPeso(Number(r.total_amount || 0))]), styles: { fontSize: 8 }, didDrawPage: data => addPageFooter(doc, data.pageNumber) });
    doc.save(`POS-Sales-Summary-${fromDate}-to-${toDate}.pdf`);
}

async function generateProductSalesReport(fromDate, toDate, cashierId = null, filenamePrefix = 'Product-Sales-Performance') {
    const { rows } = await fetchPosTransactions(fromDate, toDate, true, cashierId);
    if (!rows.length) throw new Error('No completed POS sales found for the selected period');
    const products = {};
    rows.forEach(row => (row.pos_transaction_items || []).forEach(item => {
        const key = item.product_id || item.product_name;
        products[key] ||= { name: item.product_name || 'Unknown product', units: 0, revenue: 0, transactions: 0 };
        products[key].units += Number(item.quantity || 0);
        products[key].revenue += Number(item.line_total ?? (Number(item.unit_price || 0) * Number(item.quantity || 0)));
        products[key].transactions++;
    }));
    const ranked = Object.values(products).sort((a, b) => b.revenue - a.revenue);
    const totalRevenue = ranked.reduce((sum, item) => sum + item.revenue, 0);
    const doc = new (window.jspdf?.jsPDF || window.jsPDF)();
    let y = addReportHeader(doc, 'PRODUCT SALES PERFORMANCE REPORT', 20);
    y = addSectionHeader(doc, 'PRODUCT RANKING', y + 10);
    doc.autoTable({ startY: y, head: [['Rank', 'Product', 'Units Sold', 'Line Sales', 'Sales Share']], body: ranked.map((item, i) => [String(i + 1), item.name, String(item.units), formatPeso(item.revenue), totalRevenue ? `${(item.revenue / totalRevenue * 100).toFixed(1)}%` : '0.0%']), theme: 'striped', styles: { fontSize: 8 }, didDrawPage: data => addPageFooter(doc, data.pageNumber) });
    doc.save(`${filenamePrefix}-${fromDate}-to-${toDate}.pdf`);
}

async function generateCashierPerformanceReport(fromDate, toDate) {
    const { rows } = await fetchPosTransactions(fromDate, toDate, true);
    if (!rows.length) throw new Error('No completed POS sales found for the selected period');
    const cashierIds = [...new Set(rows.map(row => row.cashier_id).filter(Boolean))];
    let users = [];
    if (cashierIds.length) {
        const { data, error: usersError } = await window.supabaseClient
            .from('users').select('user_id, first_name, last_name, email').in('user_id', cashierIds);
        if (usersError) throw usersError;
        users = data || [];
    }
    const names = Object.fromEntries((users || []).map(user => [user.user_id, `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email || 'Unknown cashier']));
    const stats = {};
    rows.forEach(row => {
        const id = row.cashier_id || 'unknown';
        stats[id] ||= { sales: 0, transactions: 0, units: 0, discounts: 0, cash: 0, digital: 0 };
        const item = stats[id];
        const sale = Number(row.total_amount || 0);
        item.sales += sale;
        item.transactions++;
        item.discounts += Number(row.discount_amount || 0);
        item.units += (row.pos_transaction_items || []).reduce((sum, line) => sum + Number(line.quantity || 0), 0);
        if (row.payment_method === 'bank_transfer') item.digital += sale;
        else item.cash += sale;
    });
    const ranked = Object.entries(stats).sort((a, b) => b[1].sales - a[1].sales);
    const doc = new (window.jspdf?.jsPDF || window.jsPDF)('landscape');
    let y = addReportHeader(doc, 'SALES BY CASHIER REPORT', 20);
    y = addSectionHeader(doc, 'CASHIER PERFORMANCE RANKING', y + 10);
    doc.autoTable({ startY: y, head: [['Rank', 'Cashier', 'Transactions', 'Units', 'Net Sales', 'Average Sale', 'Discounts', 'Cash', 'QR / E-wallet']], body: ranked.map(([id, v], index) => [String(index + 1), names[id] || 'Unknown cashier', String(v.transactions), String(v.units), formatPeso(v.sales), formatPeso(v.sales / v.transactions), formatPeso(v.discounts), formatPeso(v.cash), formatPeso(v.digital)]), styles: { fontSize: 8 }, theme: 'striped', didDrawPage: data => addPageFooter(doc, data.pageNumber) });
    doc.save(`Sales-by-Cashier-${fromDate}-to-${toDate}.pdf`);
}

async function generateCashierPaymentReport(fromDate, toDate) {
    if (!reportsUserId) throw new Error('Unable to identify the current cashier');
    const { rows } = await fetchPosTransactions(fromDate, toDate, true, reportsUserId);
    if (!rows.length) throw new Error('You have no completed POS sales for the selected period');
    const payments = {};
    const daily = {};
    let grossSales = 0;
    let netSales = 0;
    let discounts = 0;
    let tax = 0;
    rows.forEach(row => {
        const method = row.payment_method === 'bank_transfer' ? 'QR / E-wallet' : (row.payment_method || 'Cash');
        payments[method] ||= { count: 0, amount: 0 };
        payments[method].count++;
        payments[method].amount += Number(row.total_amount || 0);
        const day = new Date(row.transaction_datetime).toLocaleDateString('en-PH');
        daily[day] ||= { count: 0, amount: 0 };
        daily[day].count++;
        daily[day].amount += Number(row.total_amount || 0);
        grossSales += Number(row.subtotal || 0);
        netSales += Number(row.total_amount || 0);
        discounts += Number(row.discount_amount || 0);
        tax += Number(row.tax_amount || 0);
    });
    const doc = new (window.jspdf?.jsPDF || window.jsPDF)();
    let y = addReportHeader(doc, 'MY PAYMENT AND DISCOUNT SUMMARY', 20);
    y = addSectionHeader(doc, 'RECONCILIATION SUMMARY', y + 10);
    doc.autoTable({ startY: y, body: [
        ['Transactions', String(rows.length)], ['Gross Sales', formatPeso(grossSales)],
        ['Discounts Given', formatPeso(discounts)], ['Discount Rate', grossSales ? `${(discounts / grossSales * 100).toFixed(2)}%` : '0.00%'],
        ['Tax Collected', formatPeso(tax)], ['Net Sales Collected', formatPeso(netSales)]
    ], theme: 'grid' });
    y = addSectionHeader(doc, 'PAYMENT METHOD BREAKDOWN', doc.lastAutoTable.finalY + 12);
    doc.autoTable({ startY: y, head: [['Payment Method', 'Transactions', 'Amount']], body: Object.entries(payments).map(([method, value]) => [method, String(value.count), formatPeso(value.amount)]), theme: 'striped' });
    y = addSectionHeader(doc, 'DAILY RECONCILIATION', doc.lastAutoTable.finalY + 12);
    doc.autoTable({ startY: y, head: [['Date', 'Transactions', 'Collected']], body: Object.entries(daily).map(([day, value]) => [day, String(value.count), formatPeso(value.amount)]), theme: 'striped', didDrawPage: data => addPageFooter(doc, data.pageNumber) });
    doc.save(`My-Payment-Discount-Summary-${fromDate}-to-${toDate}.pdf`);
}

async function generateOutboundActivityReport(fromDate, toDate) {
    const { data: rows, error } = await window.supabaseClient.from('stock_movements').select(`movement_date, reference_id, quantity_change, notes, performed_by, products(product_code, product_name)`).eq('movement_type', 'outbound').gte('movement_date', `${fromDate}T00:00:00`).lte('movement_date', `${toDate}T23:59:59.999`).order('movement_date', { ascending: false });
    if (error) throw error;
    if (!rows?.length) throw new Error('No stock removals found for the selected period');
    const userIds = [...new Set(rows.map(row => row.performed_by).filter(Boolean))];
    let names = {};
    if (userIds.length) {
        const { data: users } = await window.supabaseClient.from('users').select('user_id, first_name, last_name').in('user_id', userIds);
        names = Object.fromEntries((users || []).map(user => [user.user_id, `${user.first_name || ''} ${user.last_name || ''}`.trim()]));
    }
    const reasons = {};
    rows.forEach(row => {
        const reason = (row.notes || 'Other').split(':')[0].trim() || 'Other';
        reasons[reason] = (reasons[reason] || 0) + Math.abs(Number(row.quantity_change || 0));
    });
    const units = rows.reduce((sum, row) => sum + Math.abs(Number(row.quantity_change || 0)), 0);
    const products = new Set(rows.map(row => row.products?.product_code).filter(Boolean)).size;
    const doc = new (window.jspdf?.jsPDF || window.jsPDF)();
    let y = addReportHeader(doc, 'STOCK REMOVAL REPORT', 20);
    y = addSectionHeader(doc, 'STOCK REMOVAL SUMMARY', y + 10);
    doc.autoTable({ startY: y, body: [['Transactions', String(rows.length)], ['Units Dispatched', String(units)], ['Unique Products', String(products)]], theme: 'grid' });
    y = addSectionHeader(doc, 'OUTBOUND BY REASON', doc.lastAutoTable.finalY + 12);
    doc.autoTable({ startY: y, head: [['Reason', 'Units']], body: Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([reason, count]) => [reason, String(count)]), theme: 'striped' });
    y = addSectionHeader(doc, 'DISPATCH REGISTER', doc.lastAutoTable.finalY + 12);
    doc.autoTable({ startY: y, head: [['Date', 'Product', 'Reference', 'Qty', 'Performed By', 'Notes']], body: rows.map(row => [new Date(row.movement_date).toLocaleString('en-PH'), `${row.products?.product_code || ''} ${row.products?.product_name || 'Unknown'}`.trim(), row.reference_id || 'N/A', String(Math.abs(Number(row.quantity_change || 0))), names[row.performed_by] || 'System', row.notes || '']), styles: { fontSize: 7 }, didDrawPage: data => addPageFooter(doc, data.pageNumber) });
    doc.save(`Outbound-Activity-${fromDate}-to-${toDate}.pdf`);
}

async function generateVoidedSalesReport(fromDate, toDate) {
    const { rows } = await fetchPosTransactions(fromDate, toDate, false);
    if (!rows.length) throw new Error('No voided POS transactions found for the selected period');
    const value = rows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
    const doc = new (window.jspdf?.jsPDF || window.jsPDF)();
    let y = addReportHeader(doc, 'VOIDED POS TRANSACTIONS REPORT', 20);
    y = addSectionHeader(doc, 'VOID SUMMARY', y + 10);
    doc.autoTable({ startY: y, body: [['Voided Transactions', String(rows.length)], ['Cancelled Sales Value', formatPeso(value)]], theme: 'grid' });
    y = addSectionHeader(doc, 'VOID REGISTER', doc.lastAutoTable.finalY + 12);
    doc.autoTable({ startY: y, head: [['Transaction', 'Date/Time', 'Payment', 'Amount', 'Reason']], body: rows.map(r => [r.transaction_number || 'N/A', new Date(r.transaction_datetime).toLocaleString('en-PH'), r.payment_method || 'cash', formatPeso(Number(r.total_amount || 0)), r.void_reason || 'Not provided']), styles: { fontSize: 8 }, didDrawPage: data => addPageFooter(doc, data.pageNumber) });
    doc.save(`Voided-POS-Transactions-${fromDate}-to-${toDate}.pdf`);
}

async function generateCashierSalesReport(fromDate, toDate) {
    if (!reportsUserId) throw new Error('Unable to identify the current cashier');

    const start = fromDate ? new Date(`${fromDate}T00:00:00`) : new Date();
    if (!fromDate) start.setHours(0, 0, 0, 0);
    const end = toDate ? new Date(`${toDate}T23:59:59.999`) : new Date(start);
    if (!toDate) end.setHours(23, 59, 59, 999);

    const { data, error } = await window.supabaseClient
        .from('pos_transactions')
        .select('transaction_number, transaction_datetime, total_amount, payment_method, pos_transaction_items(quantity)')
        .eq('cashier_id', reportsUserId)
        .eq('is_active', true)
        .gte('transaction_datetime', start.toISOString())
        .lte('transaction_datetime', end.toISOString())
        .order('transaction_datetime', { ascending: false });
    if (error) throw error;
    if (!data?.length) throw new Error('No transactions recorded for the selected period');

    const totalSales = data.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
    const itemsSold = data.reduce((sum, row) => sum +
        (row.pos_transaction_items || []).reduce((itemSum, item) => itemSum + Number(item.quantity || 0), 0), 0);
    const doc = new (window.jspdf?.jsPDF || window.jsPDF)();
    let yPos = addReportHeader(doc, 'CASHIER SALES REPORT', 20);
    yPos = addSectionHeader(doc, 'CASHIER ACCOUNT SUMMARY', yPos + 10);
    doc.autoTable({
        startY: yPos + 5,
        body: [
            ['Period', `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`],
            ['Total Sales', formatPeso(totalSales)],
            ['Transactions', String(data.length)],
            ['Items Sold', String(itemsSold)],
            ['Average Transaction', formatPeso(totalSales / data.length)]
        ],
        theme: 'grid'
    });
    yPos = doc.lastAutoTable.finalY + 10;
    yPos = addSectionHeader(doc, 'TRANSACTION HISTORY', yPos);
    doc.autoTable({
        startY: yPos + 5,
        head: [['Transaction', 'Date/Time', 'Items', 'Payment', 'Total']],
        body: data.map(row => [
            row.transaction_number || 'N/A',
            new Date(row.transaction_datetime).toLocaleString(),
            String((row.pos_transaction_items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0)),
            row.payment_method || 'cash',
            formatPeso(Number(row.total_amount || 0))
        ]),
        styles: { fontSize: 8 }
    });
    doc.save(`cashier-sales-${start.toISOString().slice(0, 10)}.pdf`);
}

function formatPeso(amount) {
    return 'PHP ' + amount.toLocaleString('en-PH', {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

// ===== COMPLETE INVENTORY REPORT =====
async function generateCompleteInventoryReport() {
    console.log('Generating complete inventory report...');
    let query = window.supabaseClient
        .from('products')
        .select(`
            product_id,
            product_code,
            product_name,
            unit_of_measure,
            unit_price,
            selling_price,
            reorder_level,
            inventory_stock!inventory_stock_product_id_fkey(quantity)
        `)
        .eq('is_active', true)
        .order('product_name');
    
    const { data: products, error } = await query;
    if (error) throw error;
    if (!products || products.length === 0) throw new Error('No products found');
    
    console.log('Products loaded:', products.length);
    
    // Calculate metrics
    const metrics = calculateInventoryMetrics(products);
    
    // Create PDF
    const jsPDFConstructor = window.jspdf?.jsPDF || window.jsPDF;
    const doc = new jsPDFConstructor();
    let yPos = 20;
    
    // Header with company info
    yPos = addReportHeader(doc, 'COMPLETE INVENTORY REPORT', yPos);
    
    // Executive Summary
    yPos = addSectionHeader(doc, 'EXECUTIVE SUMMARY', yPos + 10);
    
    const summaryData = [
        ['Total Products', metrics.totalProducts.toString()],
        ['Total Stock Value (Cost)', formatPeso(metrics.totalCostValue)],
        ['Total Stock Value (Selling)', formatPeso(metrics.totalSellingValue)],
        ['Products In Stock', metrics.inStock.toString()],
        ['Low Stock Items', metrics.lowStock.toString()],
        ['Out of Stock Items', metrics.outOfStock.toString()]
    ];
    
    doc.autoTable({
        startY: yPos,
        body: summaryData,
        theme: 'plain',
        styles: { fontSize: 10, cellPadding: 3 },
        columnStyles: {
            0: { fontStyle: 'bold', cellWidth: 70 },
            1: { halign: 'left' }
        }
    });
    
    yPos = doc.lastAutoTable.finalY + 15;
    
    // Check if we need a new page
    if (yPos > 250) {
        doc.addPage();
        yPos = 20;
    }
    
    // Complete Product Listing
    yPos = addSectionHeader(doc, 'COMPLETE PRODUCT LISTING', yPos);
    
    const productData = products.map(p => {
        const stock = p.inventory_stock?.[0] || p.inventory_stock || {};
        const quantity = stock?.quantity || 0;
        
        let status = 'In Stock';
        if (quantity === 0) status = 'Out of Stock';
        else if (quantity <= (p.reorder_level || 10)) status = 'Low Stock';
        
        const value = quantity * (p.unit_price || 0);
        
        return [
            p.product_code || 'N/A',
            p.product_name || 'N/A',
            quantity.toString(),
            p.unit_of_measure || 'pcs',
            status,
            formatPeso(p.unit_price || 0),
            formatPeso(value)
        ];
    });
    
    doc.autoTable({
        startY: yPos,
        head: [['Code', 'Product Name', 'Qty', 'Unit', 'Status', 'Unit Price', 'Total Value']],
        body: productData,
        theme: 'striped',
        headStyles: { fillColor: [37, 99, 235], fontSize: 8 },
        styles: { fontSize: 8, cellPadding: 2 },
        columnStyles: {
            0: { cellWidth: 20 },
            1: { cellWidth: 50 },
            2: { halign: 'center', cellWidth: 15 },
            3: { halign: 'center', cellWidth: 15 },
            4: { halign: 'center', cellWidth: 22 },
            5: { halign: 'right', cellWidth: 25 },
            6: { halign: 'right', cellWidth: 30 }
        },
        didDrawPage: (data) => {
            addPageFooter(doc, data.pageNumber);
        }
    });
    
    // Save
    const filename = `Complete-Inventory-Report-${getDateStamp()}.pdf`;
    doc.save(filename);
    console.log('✓ Complete inventory report saved:', filename);
}

// ===== LOW STOCK REPORT =====
async function generateLowStockReport() {
    console.log('Generating low stock report...');
    
    let query = window.supabaseClient
        .from('products')
        .select(`
            product_id,
            product_code,
            product_name,
            unit_of_measure,
            unit_price,
            selling_price,
            reorder_level,
            inventory_stock!inventory_stock_product_id_fkey(quantity)
        `)
        .eq('is_active', true)
        .order('product_name');
    
    const { data: products, error } = await query;
    if (error) throw error;
    
    // Filter low stock items
    const lowStockItems = products.filter(p => {
        const stock = p.inventory_stock?.[0] || p.inventory_stock || {};
        const quantity = stock?.quantity || 0;
        const reorder = p.reorder_level || 10;
        return quantity > 0 && quantity <= reorder;
    });
    
    if (lowStockItems.length === 0) {
        throw new Error('No low stock items found');
    }
    
    const jsPDFConstructor = window.jspdf?.jsPDF || window.jsPDF;
    const doc = new jsPDFConstructor();
    let yPos = 20;
    
    yPos = addReportHeader(doc, 'LOW STOCK ALERT REPORT', yPos);
    
    // Alert Summary
    yPos = addSectionHeader(doc, 'ALERT SUMMARY', yPos + 10);
    
    const totalReorderCost = lowStockItems.reduce((sum, p) => {
        const stock = p.inventory_stock?.[0] || p.inventory_stock || {};
        const quantity = stock?.quantity || 0;
        const reorderQty = Math.max((p.reorder_level || 10) - quantity + 10, 0);
        return sum + (reorderQty * (p.unit_price || 0));
    }, 0);
    
    const alertSummary = [
        ['Items Requiring Attention', lowStockItems.length.toString()],
        ['Estimated Reorder Cost', formatPeso(totalReorderCost)],
        ['Priority Level', 'HIGH - Immediate Action Required']
    ];
    
    doc.autoTable({
        startY: yPos,
        body: alertSummary,
        theme: 'plain',
        styles: { fontSize: 10, cellPadding: 3 },
        columnStyles: {
            0: { fontStyle: 'bold', cellWidth: 70 },
            1: { halign: 'left' }
        }
    });
    
    yPos = doc.lastAutoTable.finalY + 15;
    
    // Priority Reorder List
    yPos = addSectionHeader(doc, 'PRIORITY RESTOCK LIST', yPos);
    
    const reorderData = lowStockItems
        .sort((a, b) => {
            const aStock = (a.inventory_stock?.[0] || a.inventory_stock || {}).quantity || 0;
            const bStock = (b.inventory_stock?.[0] || b.inventory_stock || {}).quantity || 0;
            return aStock - bStock;
        })
        .map(p => {
            const stock = p.inventory_stock?.[0] || p.inventory_stock || {};
            const quantity = stock?.quantity || 0;
            const reorderLevel = p.reorder_level || 10;
            const suggestedQty = Math.max(reorderLevel - quantity + 10, 0);
            const reorderCost = suggestedQty * (p.unit_price || 0);
            
            return [
                p.product_code || 'N/A',
                p.product_name || 'N/A',
                quantity.toString(),
                reorderLevel.toString(),
                suggestedQty.toString(),
                formatPeso(p.unit_price || 0),
                formatPeso(reorderCost)
            ];
        });
    
    doc.autoTable({
        startY: yPos,
        head: [['Code', 'Product', 'Current', 'Reorder Lvl', 'Suggested Qty', 'Unit Price', 'Est. Cost']],
        body: reorderData,
        theme: 'striped',
        headStyles: { fillColor: [220, 38, 38], fontSize: 8 },
        styles: { fontSize: 8, cellPadding: 2 },
        columnStyles: {
            0: { cellWidth: 20 },
            1: { cellWidth: 55 },
            2: { halign: 'center', cellWidth: 18 },
            3: { halign: 'center', cellWidth: 20 },
            4: { halign: 'center', cellWidth: 22 },
            5: { halign: 'right', cellWidth: 26 },
            6: { halign: 'right', cellWidth: 28 }
        },
        didDrawPage: (data) => {
            addPageFooter(doc, data.pageNumber);
        }
    });
    
    const filename = `Low-Stock-Alert-Report-${getDateStamp()}.pdf`;
    doc.save(filename);
    console.log('✓ Low stock report saved:', filename);
}

// ===== VALUATION REPORT =====
async function generateValuationReport() {
    console.log('Generating valuation report...');
    
    let query = window.supabaseClient
        .from('products')
        .select(`
            product_id,
            product_code,
            product_name,
            unit_of_measure,
            unit_price,
            selling_price,
            inventory_stock!inventory_stock_product_id_fkey(quantity)
        `)
        .eq('is_active', true)
        .order('product_name');
    
    const { data: products, error } = await query;
    if (error) throw error;
    if (!products || products.length === 0) throw new Error('No products found');
    
    // Calculate valuations
    let totalCost = 0;
    let totalSelling = 0;
    
    products.forEach(p => {
        const stock = p.inventory_stock?.[0] || p.inventory_stock || {};
        const quantity = stock?.quantity || 0;
        const costValue = quantity * (p.unit_price || 0);
        const sellingValue = quantity * (p.selling_price || 0);
        
        totalCost += costValue;
        totalSelling += sellingValue;
    });
    
    const potentialProfit = totalSelling - totalCost;
    const profitMargin = totalCost > 0 ? (potentialProfit / totalCost * 100) : 0;
    
    const jsPDFConstructor = window.jspdf?.jsPDF || window.jsPDF;
    const doc = new jsPDFConstructor();
    let yPos = 20;
    
    yPos = addReportHeader(doc, 'INVENTORY VALUATION REPORT', yPos);
    
    // Financial Summary
    yPos = addSectionHeader(doc, 'FINANCIAL SUMMARY', yPos + 10);
    
    const financialSummary = [
        ['Total Cost Value', formatPeso(totalCost)],
        ['Total Selling Value', formatPeso(totalSelling)],
        ['Total Products', products.length.toString()]
    ];
    
    doc.autoTable({
        startY: yPos,
        body: financialSummary,
        theme: 'plain',
        styles: { fontSize: 10, cellPadding: 3 },
        columnStyles: {
            0: { fontStyle: 'bold', cellWidth: 70 },
            1: { halign: 'left', fontStyle: 'bold' }
        }
    });
    
    yPos = doc.lastAutoTable.finalY + 15;
    
    // Detailed Product Valuation
    yPos = addSectionHeader(doc, 'DETAILED PRODUCT VALUATION', yPos);
    
    const productData = products.map(p => {
        const stock = p.inventory_stock?.[0] || p.inventory_stock || {};
        const quantity = stock?.quantity || 0;
        const costValue = quantity * (p.unit_price || 0);
        const sellingValue = quantity * (p.selling_price || 0);
        const profit = sellingValue - costValue;
        
        return [
            p.product_code || 'N/A',
            p.product_name || 'N/A',
            quantity.toString(),
            formatPeso(p.unit_price || 0),
            formatPeso(p.selling_price || 0),
            formatPeso(costValue),
            formatPeso(sellingValue),
            formatPeso(profit)
        ];
    });
    
    doc.autoTable({
        startY: yPos,
        head: [['Code', 'Product', 'Qty', 'Cost', 'Selling', 'Cost Value', 'Selling Value', 'Profit']],
        body: productData,
        theme: 'striped',
        headStyles: { fillColor: [37, 99, 235], fontSize: 8 },
        styles: { fontSize: 8, cellPadding: 2 },
        columnStyles: {
            0: { cellWidth: 18 },
            1: { cellWidth: 50 },
            2: { halign: 'center', cellWidth: 15 },
            3: { halign: 'right', cellWidth: 20 },
            4: { halign: 'right', cellWidth: 20 },
            5: { halign: 'right', cellWidth: 23 },
            6: { halign: 'right', cellWidth: 23 },
            7: { halign: 'right', cellWidth: 23 }
        },
        didDrawPage: (data) => {
            addPageFooter(doc, data.pageNumber);
        }
    });
    
    const filename = `Inventory-Valuation-Report-${getDateStamp()}.pdf`;
    doc.save(filename);
    console.log('✓ Valuation report saved:', filename);
}

// ===== STOCK MOVEMENT REPORT =====
async function generateMovementReport(fromDate, toDate) {
    console.log('Generating movement report...');
    
    let query = window.supabaseClient
        .from('stock_movements')
        .select(`
            movement_id,
            product_id,
            movement_type,
            reference_type,
            reference_id,
            quantity_change,
            quantity_after,
            movement_date,
            performed_by,
            notes,
            products (
                product_code,
                product_name
            )
        `)
        .gte('movement_date', fromDate)
        .lte('movement_date', toDate + 'T23:59:59')
        .order('movement_date', { ascending: false });
    
    const { data: movements, error } = await query;
    if (error) throw error;
    
    // Filter movements
    let filtered = movements || [];
    
    if (filtered.length === 0) {
        throw new Error('No stock changes found for the selected period');
    }
    
    // Calculate statistics
    const stats = {
        totalMovements: filtered.length,
        totalAdditions: 0,
        totalReductions: 0,
        byType: {},
        byProduct: {}
    };
    
    filtered.forEach(m => {
        if (m.quantity_change > 0) {
            stats.totalAdditions += m.quantity_change;
        } else {
            stats.totalReductions += Math.abs(m.quantity_change);
        }
        
        stats.byType[m.movement_type] = (stats.byType[m.movement_type] || 0) + 1;
        
        const productName = m.products?.product_name || 'Unknown';
        if (!stats.byProduct[productName]) {
            stats.byProduct[productName] = { additions: 0, reductions: 0, netChange: 0 };
        }
        stats.byProduct[productName].netChange += m.quantity_change;
        if (m.quantity_change > 0) {
            stats.byProduct[productName].additions += m.quantity_change;
        } else {
            stats.byProduct[productName].reductions += Math.abs(m.quantity_change);
        }
    });
    
    const jsPDFConstructor = window.jspdf?.jsPDF || window.jsPDF;
    const doc = new jsPDFConstructor();
    let yPos = 20;
    
    yPos = addReportHeader(doc, 'STOCK CHANGE REPORT', yPos);
    
    // Period and Summary
    yPos = addSectionHeader(doc, 'REPORT PERIOD', yPos + 10);
    
    const periodInfo = [
        ['From Date', new Date(fromDate).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })],
        ['To Date', new Date(toDate).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })],
        ['Total Movements', stats.totalMovements.toString()],
        ['Total Stock Additions', stats.totalAdditions.toString()],
        ['Total Stock Reductions', stats.totalReductions.toString()],
        ['Net Stock Change', (stats.totalAdditions - stats.totalReductions).toString()]
    ];
    
    doc.autoTable({
        startY: yPos,
        body: periodInfo,
        theme: 'plain',
        styles: { fontSize: 10, cellPadding: 3 },
        columnStyles: {
            0: { fontStyle: 'bold', cellWidth: 70 },
            1: { halign: 'left' }
        }
    });
    
    yPos = doc.lastAutoTable.finalY + 15;
    
    // Movement Type Breakdown
    yPos = addSectionHeader(doc, 'MOVEMENT TYPE BREAKDOWN', yPos);
    
    const typeData = Object.entries(stats.byType)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => [
            type.charAt(0).toUpperCase() + type.slice(1),
            count.toString(),
            ((count / stats.totalMovements) * 100).toFixed(1) + '%'
        ]);
    
    doc.autoTable({
        startY: yPos,
        head: [['Movement Type', 'Count', '% of Total']],
        body: typeData,
        theme: 'striped',
        headStyles: { fillColor: [37, 99, 235], fontSize: 9 },
        styles: { fontSize: 9, cellPadding: 3 },
        columnStyles: {
            1: { halign: 'center' },
            2: { halign: 'right' }
        }
    });
    
    yPos = doc.lastAutoTable.finalY + 15;
    
    if (yPos > 250) {
        doc.addPage();
        yPos = 20;
    }
    
    // Detailed Transaction History
    yPos = addSectionHeader(doc, 'DETAILED TRANSACTION HISTORY', yPos);
    
    const transactionData = filtered.map(m => {
        const date = new Date(m.movement_date);
        const change = m.quantity_change > 0 ? `+${m.quantity_change}` : m.quantity_change.toString();
        
        return [
            date.toLocaleDateString('en-PH', { month: '2-digit', day: '2-digit', year: '2-digit' }),
            date.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: false }),
            m.products?.product_code || 'N/A',
            m.products?.product_name || 'N/A',
            m.movement_type || 'N/A',
            (m.reference_type || '') + (m.reference_id ? ': ' + m.reference_id : ''),
            change,
            (m.quantity_after || 'N/A').toString()
        ];
    });
    
    doc.autoTable({
        startY: yPos,
        head: [['Date', 'Time', 'Code', 'Product', 'Type', 'Reference', 'Change', 'Balance']],
        body: transactionData,
        theme: 'striped',
        headStyles: { fillColor: [37, 99, 235], fontSize: 7 },
        styles: { fontSize: 7, cellPadding: 2 },
        columnStyles: {
            0: { cellWidth: 20 },
            1: { cellWidth: 16 },
            2: { cellWidth: 18 },
            3: { cellWidth: 40 },
            4: { cellWidth: 22 },
            5: { cellWidth: 30 },
            6: { halign: 'center', cellWidth: 16 },
            7: { halign: 'center', cellWidth: 16 }
        },
        didDrawPage: (data) => {
            addPageFooter(doc, data.pageNumber);
        }
    });
    
    const filename = `Stock-Movement-Report-${fromDate}-to-${toDate}.pdf`;
    doc.save(filename);
    console.log('✓ Movement report saved:', filename);
}

// ===== HELPER FUNCTIONS =====

function addReportHeader(doc, title, yPos) {
    const pageWidth = doc.internal.pageSize.width;
    const centerX = pageWidth / 2;
    // Company/System name
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text('AMACAR HARDWARE INVENTORY SYSTEM', centerX, yPos, { align: 'center' });
    
    // Report title
    doc.setFontSize(16);
    doc.text(title, centerX, yPos + 8, { align: 'center' });
    
    // Date and time
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-PH', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });
    const timeStr = now.toLocaleTimeString('en-PH', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true
    });
    doc.text(`Generated: ${dateStr} at ${timeStr}`, centerX, yPos + 14, { align: 'center' });
    
    // Divider line
    doc.setDrawColor(200, 200, 200);
    doc.line(14, yPos + 18, pageWidth - 14, yPos + 18);
    
    return yPos + 18;
}

function addSectionHeader(doc, title, yPos) {
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(37, 99, 235);
    doc.text(title, 14, yPos);
    doc.setTextColor(0, 0, 0);
    doc.setFont(undefined, 'normal');
    
    return yPos + 7;
}

function addPageFooter(doc, pageNumber) {
    const pageHeight = doc.internal.pageSize.height;
    const pageWidth = doc.internal.pageSize.width;
    doc.setFontSize(8);
    doc.setTextColor(128, 128, 128);
    doc.text(
        `Page ${pageNumber}`,
        pageWidth / 2,
        pageHeight - 10,
        { align: 'center' }
    );
    doc.text(
        'Confidential - For Internal Use Only',
        14,
        pageHeight - 10
    );
    doc.setTextColor(0, 0, 0);
}

function calculateInventoryMetrics(products) {
    const metrics = {
        totalProducts: products.length,
        totalCostValue: 0,
        totalSellingValue: 0,
        inStock: 0,
        lowStock: 0,
        outOfStock: 0
    };
    
    products.forEach(p => {
        const stock = p.inventory_stock?.[0] || p.inventory_stock || {};
        const quantity = stock?.quantity || 0;
        const costValue = quantity * (p.unit_price || 0);
        const sellingValue = quantity * (p.selling_price || 0);
        
        metrics.totalCostValue += costValue;
        metrics.totalSellingValue += sellingValue;
        
        // Stock status
        if (quantity === 0) {
            metrics.outOfStock++;
        } else if (quantity <= (p.reorder_level || 10)) {
            metrics.lowStock++;
        } else {
            metrics.inStock++;
        }
    });
    
    return metrics;
}

function getDateStamp() {
    const now = new Date();
    return now.toISOString().split('T')[0];
}

function showNotification(message, type) {
    // Simple notification - you can enhance this
    if (type === 'success') {
        alert('✓ ' + message);
    } else {
        alert('✗ ' + message);
    }
}

console.log('=== PROFESSIONAL REPORTS SCRIPT LOADED ===');
