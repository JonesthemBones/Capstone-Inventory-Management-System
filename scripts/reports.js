console.log('=== PROFESSIONAL REPORTS SCRIPT LOADING ===');

document.addEventListener('DOMContentLoaded', async function() {
    console.log('=== DOM CONTENT LOADED ===');
    
    // Require authentication and role check
    await window.authHelpers.requireAuth();
    const hasAccess = await window.authHelpers.requireRole(['admin', 'manager']);
    if (!hasAccess) return;
    
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
        card.addEventListener('click', function() {
            const type = this.getAttribute('data-type');
            if (reportTypeSelect) {
                reportTypeSelect.value = type;
                updateReportPreview();
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
        
        // Validate date range for movement report
        if (reportType === 'movement' && (!fromDate || !toDate)) {
            alert('Please select a date range for Stock Movement Report');
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
                    title: 'Priority Reorder List',
                    desc: 'Products at or below reorder level'
                },
                {
                    icon: 'fa-calculator',
                    title: 'Reorder Recommendations',
                    desc: 'Suggested quantities based on stock levels'
                },
                {
                    icon: 'fa-dollar-sign',
                    title: 'Estimated Reorder Cost',
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
                    desc: 'Detailed list of all stock movements'
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
            default:
                throw new Error('Invalid report type');
        }
    } catch (error) {
        console.error('Report generation error:', error);
        throw error;
    }
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
    yPos = addSectionHeader(doc, 'PRIORITY REORDER LIST', yPos);
    
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
        throw new Error('No stock movements found for the selected period');
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
    
    yPos = addReportHeader(doc, 'STOCK MOVEMENT REPORT', yPos);
    
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
    // Company/System name
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text('AMACAR HARDWARE INVENTORY SYSTEM', 105, yPos, { align: 'center' });
    
    // Report title
    doc.setFontSize(16);
    doc.text(title, 105, yPos + 8, { align: 'center' });
    
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
    doc.text(`Generated: ${dateStr} at ${timeStr}`, 105, yPos + 14, { align: 'center' });
    
    // Divider line
    doc.setDrawColor(200, 200, 200);
    doc.line(14, yPos + 18, 196, yPos + 18);
    
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
    doc.setFontSize(8);
    doc.setTextColor(128, 128, 128);
    doc.text(
        `Page ${pageNumber}`,
        105,
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
