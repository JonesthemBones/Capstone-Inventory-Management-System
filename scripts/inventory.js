let currentEditingProductId = null;
let currentAdjustingProductId = null;
let currentUserRole = null;

document.addEventListener('DOMContentLoaded', async () => {
    const session = await window.authHelpers.requireAuth();
    if (!session) return;
    
    // Get current user role
    await loadUserRole();
    
    // Apply role-based access controls
    applyRoleBasedAccess();
    
    await loadInventory();
    initImageUpload();
    setupEventListeners();
    setupRealtimeSubscriptions();
});

async function loadUserRole() {
    try {
        // Wait for window.currentUserRole to be set by sidebar.js
        let attempts = 0;
        while (!window.currentUserRole && attempts < 20) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        
        currentUserRole = window.currentUserRole || 'staff';
        console.log('Current user role:', currentUserRole);
    } catch (error) {
        console.error('Error loading user role:', error);
        currentUserRole = 'staff';
    }
}

function applyRoleBasedAccess() {
    // Hide backup/restore buttons for staff and cashier roles
    if (currentUserRole === 'staff' || currentUserRole === 'cashier') {
        const backupRestoreButtons = document.querySelectorAll('.role-backup-restore');
        backupRestoreButtons.forEach(btn => {
            btn.style.display = 'none';
        });
    }
    
    // For cashiers: hide buttons that require staff or admin access
    if (currentUserRole === 'cashier') {
        const staffButtons = document.querySelectorAll('.role-requires-staff-or-admin');
        staffButtons.forEach(btn => {
            btn.style.display = 'none';
        });
    }
}

async function loadInventory(filters = {}) {
    try {
        console.log('Starting inventory load...');
        let query = supabaseClient
        .from('products')
        .select(`
            *,
            inventory_stock!inventory_stock_product_id_fkey(quantity)
        `)
        .order('product_name');
        
        if (filters.search) {
            query = query.or(`product_name.ilike.%${filters.search}%,product_code.ilike.%${filters.search}%`);
        }
        
        console.log('Executing query...');
        const { data: products, error } = await query;
        
        if (error) {
            console.error('Supabase Query Error:', error);
            throw error;
        }
        console.log('Query results:', products);

        let filteredProducts = products || [];
        if (filters.status) {
            filteredProducts = filteredProducts.filter(p => {
                const inventory = p.inventory_stock?.[0] || p.inventory_stock;
                const qty = inventory?.quantity || 0;
                if (filters.status === 'in_stock') return qty >= 10;
                if (filters.status === 'low_stock') return qty > 0 && qty < 10;
                if (filters.status === 'out_of_stock') return qty === 0;
                return true;
            });
        }

        await backfillMissingProductCodes(filteredProducts);
        
        displayInventory(filteredProducts);
        document.getElementById('inventory-count').textContent = 
            `${filteredProducts.length} items in inventory`;
        
    } catch (error) {
        console.error('Error loading inventory:', error);
    }
}

async function backfillMissingProductCodes(products) {
    if (!Array.isArray(products) || products.length === 0) {
        return;
    }

    const missingCodes = products.filter(p => !p.product_code && p.product_id && p.product_name);
    if (missingCodes.length === 0) {
        return;
    }

    for (const product of missingCodes) {
        const generatedCode = generateSKU(product.product_name || 'PRD');
        const { error } = await supabaseClient
            .from('products')
            .update({ product_code: generatedCode })
            .eq('product_id', product.product_id);

        if (!error) {
            product.product_code = generatedCode;
        } else {
            console.warn('Unable to backfill product code for', product.product_id, error);
        }
    }
}

function displayInventory(products) {
    const tbody = document.getElementById('inventory-table-body');
    
    if (!products || products.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" style="text-align: center; padding: 40px; color: var(--text-secondary);">
                    No products found
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = products.map(product => {
        const inventory = product.inventory_stock?.[0] || product.inventory_stock || product.inventory?.[0] || {};
        const quantity = inventory.quantity || 0;
        const totalValue = quantity * (product.unit_price || 0);
        
        console.log(`Displaying ${product.product_name}:`, {
            quantity: quantity
        });
        
        let status = 'out_of_stock';
        let statusClass = 'status-out';
        let statusText = 'Out of Stock';
        
        if (quantity >= 10) {
            status = 'in_stock';
            statusClass = 'status-in';
            statusText = 'In Stock';
        } else if (quantity > 0) {
            status = 'low_stock';
            statusClass = 'status-low';
            statusText = 'Low Stock';
        }
        
        // Generate action buttons based on role
        let actionButtons = '';
        if (currentUserRole === 'cashier') {
            // Cashiers get no action buttons (read-only view)
            actionButtons = '<span style="color: var(--text-secondary); font-size: 12px;">View Only</span>';
        } else {
            // Staff and admins get full action buttons
            actionButtons = `
                <div class="action-btns">
                    <button class="icon-btn adjust-btn" data-id="${product.product_id}" title="Adjust Stock">
                        <i class="fas fa-boxes"></i>
                    </button>
                    <button class="icon-btn edit-btn" data-id="${product.product_id}" title="Edit Product">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="icon-btn delete delete-btn" data-id="${product.product_id}" title="Delete Product">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
        }
        
        // Generate thumbnail
        let thumbnailCell = '';
        if (product.image_url) {
            thumbnailCell = `
                <td class="product-thumbnail-cell">
                    <img src="${product.image_url}" 
                         alt="${product.product_name}" 
                         class="product-thumbnail"
                         onclick="openImagePreviewModal('${product.image_url}', '${product.product_name.replace(/'/g, "\\'")}')"
                         loading="lazy">
                </td>
            `;
        } else {
            thumbnailCell = `
                <td class="product-thumbnail-cell">
                    <div class="product-thumbnail-placeholder" 
                         onclick="openUploadImageModal('${product.product_id}')"
                         title="Click to upload image">
                        <i class="fas fa-image"></i>
                    </div>
                </td>
            `;
        }
        
        return `
            <tr data-product-id="${product.product_id}">
                ${thumbnailCell}
                <td><strong>${product.product_name}</strong></td>
                <td>${product.product_code || 'N/A'}</td>
                <td>${product.unit_of_measure || 'N/A'}</td>
                <td><strong>${quantity}</strong></td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                <td>${formatCurrency(product.unit_price || 0)}</td>
                <td>${formatCurrency(product.selling_price || 0)}</td>
                <td><strong>${formatCurrency(totalValue)}</strong></td>
                <td>
                    ${actionButtons}
                </td>
            </tr>
        `;
    }).join('');
    
    // Only attach event listeners if the buttons exist (not for cashiers)
    if (currentUserRole !== 'cashier') {
        document.querySelectorAll('.adjust-btn').forEach(btn => {
            btn.addEventListener('click', () => openStockAdjustmentModal(btn.dataset.id));
        });
        
        document.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', () => editProduct(btn.dataset.id));
        });
        
        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', () => deleteProduct(btn.dataset.id));
        });
    }
}

function getStockAdjustmentElements() {
    return {
        modal: document.getElementById('adjust-stock-modal') || document.getElementById('stock-adjustment-modal'),
        form: document.getElementById('adjust-stock-form') || document.getElementById('stock-adjustment-form'),
        productName: document.getElementById('adjustment-product-name') || document.getElementById('stock-product-name'),
        currentQuantity: document.getElementById('current-quantity') || document.getElementById('stock-quantity'),
        quantity: document.getElementById('adjustment-quantity') || document.getElementById('stock-quantity'),
        notes: document.getElementById('adjustment-notes') || document.getElementById('stock-notes')
    };
}

function setupEventListeners() {
    document.getElementById('inventory-search').addEventListener('input', (e) => {
        const filters = getFilters();
        filters.search = e.target.value;
        loadInventory(filters);
    });
    
    document.getElementById('status-filter').addEventListener('change', (e) => {
        const filters = getFilters();
        filters.status = e.target.value;
        loadInventory(filters);
    });

    document.getElementById('product-form').addEventListener('submit', saveProduct);

    document.getElementById('add-item-btn').addEventListener('click', () => {
        currentEditingProductId = null;
        document.getElementById('modal-title').textContent = 'Add New Product';
        document.getElementById('product-form').reset();
        toggleProductThumbnailSection(false);
        const quantityInput = document.getElementById('product-quantity');
        const quantityGroup = quantityInput.closest('.form-group');
        quantityGroup.style.display = '';
        quantityInput.setAttribute('required', 'required');
        document.getElementById('product-modal').classList.add('active');
    });

    document.getElementById('close-product-modal').addEventListener('click', () => {
        document.getElementById('product-modal').classList.remove('active');
    });

    document.getElementById('cancel-product-btn').addEventListener('click', () => {
        document.getElementById('product-modal').classList.remove('active');
    });
    
    const stockElements = getStockAdjustmentElements();
    stockElements.form?.addEventListener('submit', saveStockAdjustment);
    document.getElementById('close-adjust-modal')?.addEventListener('click', () => {
        stockElements.modal?.classList.remove('active');
    });
    document.getElementById('cancel-adjust-btn')?.addEventListener('click', () => {
        stockElements.modal?.classList.remove('active');
    });

    // Export CSV event listener
    document.getElementById('export-csv-btn').addEventListener('click', exportToCSV);
    
    // Backup and Restore event listeners
    document.getElementById('export-backup-btn').addEventListener('click', exportBackup);
    document.getElementById('import-restore-btn').addEventListener('click', () => {
        document.getElementById('restore-modal').classList.add('active');
    });
    document.getElementById('close-restore-modal').addEventListener('click', () => {
        document.getElementById('restore-modal').classList.remove('active');
        resetRestoreModal();
    });
    document.getElementById('cancel-restore-btn').addEventListener('click', () => {
        document.getElementById('restore-modal').classList.remove('active');
        resetRestoreModal();
    });
    document.getElementById('backup-file').addEventListener('change', handleBackupFileSelect);
    document.getElementById('restore-mode').addEventListener('change', validateRestoreForm);
    document.getElementById('confirm-restore-btn').addEventListener('click', restoreBackup);
}

function getFilters() {
    return {
        search: document.getElementById('inventory-search').value,
        status: document.getElementById('status-filter').value
    };
}

function toggleProductThumbnailSection(show) {
    const section = document.getElementById('product-thumbnail-section');
    const button = document.getElementById('change-product-thumbnail-btn');

    if (!section) return;

    section.style.display = show ? 'block' : 'none';
    if (button) {
        button.disabled = !show;
    }
}

function updateProductThumbnailPreview(product) {
    const previewContainer = document.getElementById('product-thumbnail-preview');
    if (!previewContainer) return;

    previewContainer.innerHTML = '';

    if (product?.image_url) {
        const img = document.createElement('img');
        img.src = product.image_url;
        img.alt = product.product_name || 'Product thumbnail';
        img.className = 'product-form-thumbnail-image';
        previewContainer.appendChild(img);
    } else {
        const placeholder = document.createElement('div');
        placeholder.className = 'product-form-thumbnail-placeholder';
        placeholder.innerHTML = '<i class="fas fa-image"></i><span>No thumbnail yet</span>';
        previewContainer.appendChild(placeholder);
    }
}

function openThumbnailUploadForCurrentProduct() {
    if (!currentEditingProductId) {
        showNotification('Select an existing product first to change its thumbnail.', 'warning');
        return;
    }

    openUploadImageModal(currentEditingProductId);
}

async function openStockAdjustmentModal(productId) {
    try {
        const { data: product } = await supabaseClient
            .from('products')
            .select(`
                *,
                inventory_stock!inventory_stock_product_id_fkey(quantity)
            `)
            .eq('product_id', productId)
            .single();
        
        if (!product) throw new Error('Product not found');
        
        currentAdjustingProductId = productId;
        const inventory = product.inventory_stock?.[0] || product.inventory_stock || {};
        const currentQuantity = inventory.quantity || 0;
        const stockElements = getStockAdjustmentElements();
        
        console.log('Loading stock adjustment for:', product.product_name, 'Current quantity:', currentQuantity);
        
        if (stockElements.productName) {
            stockElements.productName.value = product.product_name;
        }
        if (stockElements.currentQuantity) {
            stockElements.currentQuantity.value = currentQuantity;
        }
        if (stockElements.quantity) {
            stockElements.quantity.value = '';
        }
        if (stockElements.notes) {
            stockElements.notes.value = '';
        }
        
        stockElements.modal?.classList.add('active');
        
    } catch (error) {
        console.error('Error loading product for adjustment:', error);
        alert('Error loading product: ' + error.message);
    }
}

async function saveStockAdjustment(e) {
    e.preventDefault();  
    const stockElements = getStockAdjustmentElements();
    const quantity = parseInt(stockElements.quantity?.value || '0');
    const notes = stockElements.notes?.value || '';
    
    try {
        // Get product with maximum stock limit
        const { data: product } = await supabaseClient
            .from('products')
            .select('maximum_stock, product_name')
            .eq('product_id', currentAdjustingProductId)
            .single();
        
        // Validate against maximum stock
        if (product.maximum_stock && quantity > product.maximum_stock) {
            alert(`❌ Cannot adjust stock!\n\nThe quantity (${quantity}) exceeds the maximum stock limit of ${product.maximum_stock} for ${product.product_name}.\n\nPlease enter a quantity at or below the maximum stock limit.`);
            return;
        }
        
        const { data: existingStock } = await supabaseClient
            .from('inventory_stock')
            .select('quantity, stock_id')
            .eq('product_id', currentAdjustingProductId)
            .maybeSingle();
        
        let updateError;
        
        if (existingStock) {
            const result = await supabaseClient
                .from('inventory_stock')
                .update({
                    quantity: quantity,
                    last_restock_date: new Date().toISOString()
                })
                .eq('product_id', currentAdjustingProductId);

            updateError = result.error;
        } else {
            const result = await supabaseClient
                .from('inventory_stock')
                .insert([{
                    product_id: currentAdjustingProductId,
                    quantity: quantity,
                    last_restock_date: new Date().toISOString()
                }]);

            updateError = result.error;
        }

        if (updateError) throw updateError;
        
        const quantityChange = quantity - (existingStock?.quantity || 0);

        await supabaseClient
            .from('stock_movements')
            .insert([{
                product_id: currentAdjustingProductId,
                movement_type: 'adjustment',
                quantity_change: quantityChange,
                quantity_after: quantity,
                notes: notes || 'Stock adjustment'
            }]);
        
        getStockAdjustmentElements().modal?.classList.remove('active');
        await loadInventory(getFilters());
        alert('Stock adjusted successfully!');
        
    } catch (error) {
        console.error('Error adjusting stock:', error);
        alert('Error adjusting stock: ' + error.message);
    }
}

async function saveProduct(e) {
    e.preventDefault();
    
    const productData = {
        product_name: document.getElementById('product-name').value,
        product_code: document.getElementById('product-code').value.trim(),
        unit_of_measure: document.getElementById('product-unit').value,
        unit_price: parseFloat(document.getElementById('product-price').value),
        selling_price: parseFloat(document.getElementById('selling-price').value),
        reorder_level: parseInt(document.getElementById('reorder-level').value),
        maximum_stock: parseInt(document.getElementById('maximum-stock').value) || null,
        description: document.getElementById('product-description').value || null
    };
    
    const quantity = parseInt(document.getElementById('product-quantity').value);
    
    try {
        let productId;
        
        if (currentEditingProductId) {
            const { error } = await supabaseClient
                .from('products')
                .update(productData)
                .eq('product_id', currentEditingProductId);
        
            if (error) throw error;
            productId = currentEditingProductId;
            
        } else {
            if (!productData.product_code) {
                productData.product_code = generateSKU(productData.product_name || 'PRD');
            }
            const { data, error } = await supabaseClient
                .from('products')
                .insert([productData])
                .select()
                .single();
            
            if (error) throw error;
            productId = data.product_id;

            await supabaseClient
                .from('inventory_stock')
                .insert([{
                    product_id: productId,
                    quantity: quantity,
                    last_restock_date: new Date().toISOString()
            }]);

            await supabaseClient
                .from('stock_movements')
                .insert([{
                    product_id: productId,
                    movement_type: 'inbound',
                    quantity_change: quantity,
                    quantity_before: 0,
                    quantity_after: quantity,
                    notes: 'Initial stock'
                }]);
        }
        
        document.getElementById('product-modal').classList.remove('active');
        await loadInventory(getFilters());
        alert(currentEditingProductId ? 'Product updated successfully!' : 'Product added successfully!');
    } catch (error) {
        console.error('Error saving product:', error);
        alert('Error saving product: ' + error.message);
    }
}

async function editProduct(productId) {
    try {
        const { data: product } = await supabaseClient
            .from('products')
            .select('*')
            .eq('product_id', productId)
            .single();
        
        if (!product) throw new Error('Product not found');
        
        currentEditingProductId = productId;
        document.getElementById('modal-title').textContent = 'Edit Product';
        document.getElementById('product-name').value = product.product_name;
        document.getElementById('product-code').value = product.product_code || '';
        document.getElementById('product-unit').value = product.unit_of_measure || '';
        document.getElementById('product-price').value = product.unit_price || 0;
        document.getElementById('selling-price').value = product.selling_price || 0;
        document.getElementById('reorder-level').value = product.reorder_level || 10;
        document.getElementById('maximum-stock').value = product.maximum_stock || '';
        document.getElementById('product-description').value = product.description || '';
        toggleProductThumbnailSection(true);
        updateProductThumbnailPreview(product);
        
        const quantityInput = document.getElementById('product-quantity');
        const quantityGroup = quantityInput.closest('.form-group');
        quantityGroup.style.display = 'none';
        quantityInput.removeAttribute('required');
        
        document.getElementById('product-modal').classList.add('active');
        
    } catch (error) {
        console.error('Error loading product:', error);
        alert('Error loading product: ' + error.message);
    }
}

async function deleteProduct(productId) {
    try {
        // First, check if the product has any stock
        const { data: stockData, error: stockError } = await supabaseClient
            .from('inventory_stock')
            .select('quantity')
            .eq('product_id', productId)
            .maybeSingle();
        
        if (stockError) throw stockError;
        
        // Check if product has quantity in stock
        const currentQuantity = stockData?.quantity || 0;
        
        if (currentQuantity > 0) {
            alert(`❌ Cannot delete this product!\n\nThis product still has ${currentQuantity} units in stock.\n\nPlease adjust the stock to 0 before deleting.`);
            return;
        }
        
        // If no stock, proceed with confirmation
        if (!confirm('Are you sure you want to delete this product?')) return;
        
        const { error } = await supabaseClient
            .from('products')
            .delete()
            .eq('product_id', productId);
        
        if (error) throw error;
        
        await loadInventory(getFilters());
        alert('Product deleted successfully!');
        
    } catch (error) {
        console.error('Error deleting product:', error);
        alert('Error deleting product: ' + error.message);
    }
}

function setupRealtimeSubscriptions() {
    supabaseClient
        .channel('products_changes')
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'products' },
            () => loadInventory(getFilters())
        )
        .subscribe();
    
    supabaseClient
        .channel('inventory_changes')
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'inventory_stock' },
            () => loadInventory(getFilters())
        )
        .subscribe();
}

async function exportToCSV() {
    try {
        // Show loading indicator
        const originalText = document.getElementById('export-csv-btn').innerHTML;
        document.getElementById('export-csv-btn').innerHTML = '<i class="fas fa-spinner fa-spin"></i> Exporting...';
        document.getElementById('export-csv-btn').disabled = true;

        // Fetch all products with their inventory data
        const { data: products, error } = await supabaseClient
            .from('products')
            .select(`
                *,
                inventory_stock!inventory_stock_product_id_fkey(quantity, updated_at)
            `)
            .order('product_name');

        if (error) throw error;

        // Prepare CSV headers
        const headers = [
            'Product Name',
            'Product Code',
            'Unit of Measure',
            'Quantity',
            'Unit Price',
            'Selling Price',
            'Total Value',
            'Reorder Level',
            'Maximum Stock',
            'Status',
            'Description'
        ];

        // Prepare CSV rows
        const rows = products.map(product => {
            const inventory = product.inventory_stock?.[0] || product.inventory_stock || {};
            const quantity = inventory.quantity || 0;
            const totalValue = quantity * (product.unit_price || 0);
            
            // Determine status
            let status = 'Out of Stock';
            if (quantity >= 10) {
                status = 'In Stock';
            } else if (quantity > 0) {
                status = 'Low Stock';
            }

            return [
                product.product_name || '',
                product.product_code || '',
                product.unit_of_measure || '',
                quantity,
                product.unit_price || 0,
                product.selling_price || 0,
                totalValue.toFixed(2),
                product.reorder_level || 0,
                product.maximum_stock || '',
                status,
                (product.description || '').replace(/"/g, '""') // Escape quotes in description
            ];
        });

        // Convert to CSV format
        const csvContent = [
            headers.map(h => `"${h}"`).join(','),
            ...rows.map(row => row.map(cell => {
                // Handle values that might contain commas or quotes
                if (typeof cell === 'string' && (cell.includes(',') || cell.includes('"') || cell.includes('\n'))) {
                    return `"${cell}"`;
                }
                return cell;
            }).join(','))
        ].join('\n');

        // Create and download CSV file
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        link.download = `inventory_export_${timestamp}.csv`;
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        // Show success message
        alert(`✅ CSV exported successfully!\n\n${products.length} products exported to file.`);

    } catch (error) {
        console.error('Error exporting CSV:', error);
        alert('Error exporting CSV: ' + error.message);
    } finally {
        // Reset button
        document.getElementById('export-csv-btn').innerHTML = '<i class="fas fa-file-csv"></i> Export CSV';
        document.getElementById('export-csv-btn').disabled = false;
    }
}

// ============================================================================
// BACKUP AND RESTORE FUNCTIONS
// ============================================================================

let selectedBackupData = null;

async function exportBackup() {
    try {
        // Show loading indicator
        const originalText = document.getElementById('export-backup-btn').innerHTML;
        document.getElementById('export-backup-btn').innerHTML = '<i class="fas fa-spinner fa-spin"></i> Exporting...';
        document.getElementById('export-backup-btn').disabled = true;

        // Fetch all products with their inventory data
        const { data: products, error } = await supabaseClient
            .from('products')
            .select(`
                *,
                inventory_stock!inventory_stock_product_id_fkey(quantity, updated_at)
            `)
            .order('product_name');

        if (error) throw error;

        // Prepare backup data
        const backupData = {
            backup_metadata: {
                export_date: new Date().toISOString(),
                total_products: products.length,
                version: '1.0',
                system: 'Amacar Hardware Inventory System'
            },
            products: products.map(product => {
                const inventory = product.inventory_stock?.[0] || product.inventory_stock || {};
                return {
                    product_name: product.product_name,
                    product_code: product.product_code,
                    unit_of_measure: product.unit_of_measure,
                    unit_price: product.unit_price,
                    selling_price: product.selling_price,
                    reorder_level: product.reorder_level,
                    maximum_stock: product.maximum_stock,
                    description: product.description,
                    quantity: inventory.quantity || 0,
                    created_at: product.created_at,
                    updated_at: product.updated_at
                };
            })
        };

        // Create and download JSON file
        const jsonString = JSON.stringify(backupData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        link.download = `inventory_backup_${timestamp}.json`;
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        // Show success message
        alert(`✅ Backup exported successfully!\n\n${products.length} products exported to file.`);

    } catch (error) {
        console.error('Error exporting backup:', error);
        alert('Error exporting backup: ' + error.message);
    } finally {
        // Reset button
        document.getElementById('export-backup-btn').innerHTML = '<i class="fas fa-download"></i> Export Backup';
        document.getElementById('export-backup-btn').disabled = false;
    }
}

async function handleBackupFileSelect(event) {
    const file = event.target.files[0];
    if (!file) {
        selectedBackupData = null;
        document.getElementById('backup-preview').style.display = 'none';
        validateRestoreForm();
        return;
    }

    try {
        const fileExtension = file.name.split('.').pop().toLowerCase();
        const fileContent = await file.text();
        
        let backupData;

        if (fileExtension === 'json') {
            backupData = JSON.parse(fileContent);
            
            // Validate JSON structure
            if (!backupData.products || !Array.isArray(backupData.products)) {
                throw new Error('Invalid backup file format. Missing products array.');
            }

            // Store backup data
            selectedBackupData = backupData;

            // Show preview
            document.getElementById('backup-preview').style.display = 'block';
            document.getElementById('preview-count').textContent = backupData.products.length;
            document.getElementById('preview-date').textContent = backupData.backup_metadata?.export_date 
                ? new Date(backupData.backup_metadata.export_date).toLocaleString()
                : 'Unknown';
            document.getElementById('preview-format').textContent = 'JSON';

        } else if (fileExtension === 'csv') {
            // Parse CSV
            const lines = fileContent.split('\n').filter(line => line.trim());
            if (lines.length < 2) {
                throw new Error('CSV file is empty or invalid.');
            }

            const headers = lines[0].split(',').map(h => h.trim());
            const products = [];

            for (let i = 1; i < lines.length; i++) {
                const values = lines[i].split(',').map(v => v.trim());
                const product = {};
                
                headers.forEach((header, index) => {
                    let value = values[index] || '';
                    // Remove quotes if present
                    value = value.replace(/^["']|["']$/g, '');
                    
                    // Convert numeric fields
                    if (['unit_price', 'selling_price'].includes(header)) {
                        product[header] = parseFloat(value) || 0;
                    } else if (['quantity', 'reorder_level', 'maximum_stock'].includes(header)) {
                        product[header] = parseInt(value) || 0;
                    } else {
                        product[header] = value;
                    }
                });
                
                if (product.product_name && product.product_code) {
                    products.push(product);
                }
            }

            selectedBackupData = {
                backup_metadata: {
                    export_date: new Date().toISOString(),
                    total_products: products.length,
                    version: '1.0',
                    system: 'CSV Import'
                },
                products: products
            };

            // Show preview
            document.getElementById('backup-preview').style.display = 'block';
            document.getElementById('preview-count').textContent = products.length;
            document.getElementById('preview-date').textContent = 'CSV Import - ' + new Date().toLocaleString();
            document.getElementById('preview-format').textContent = 'CSV';

        } else {
            throw new Error('Unsupported file format. Please use JSON or CSV files.');
        }

        validateRestoreForm();

    } catch (error) {
        console.error('Error reading backup file:', error);
        alert('Error reading backup file: ' + error.message);
        selectedBackupData = null;
        document.getElementById('backup-preview').style.display = 'none';
        document.getElementById('backup-file').value = '';
        validateRestoreForm();
    }
}

function validateRestoreForm() {
    const restoreMode = document.getElementById('restore-mode').value;
    const confirmButton = document.getElementById('confirm-restore-btn');
    
    if (selectedBackupData && restoreMode) {
        confirmButton.disabled = false;
    } else {
        confirmButton.disabled = true;
    }
}

function resetRestoreModal() {
    document.getElementById('backup-file').value = '';
    document.getElementById('restore-mode').value = '';
    document.getElementById('backup-preview').style.display = 'none';
    selectedBackupData = null;
    validateRestoreForm();
}

async function restoreBackup() {
    if (!selectedBackupData) {
        alert('Please select a backup file first.');
        return;
    }

    const restoreMode = document.getElementById('restore-mode').value;
    if (!restoreMode) {
        alert('Please select a restore mode.');
        return;
    }

    const confirmMessage = restoreMode === 'replace' 
        ? `⚠️ WARNING: This will DELETE ALL existing products and replace them with ${selectedBackupData.products.length} products from the backup.\n\nThis action cannot be undone!\n\nType 'CONFIRM' to proceed:`
        : `This will restore ${selectedBackupData.products.length} products using "${restoreMode}" mode.\n\nContinue?`;

    if (restoreMode === 'replace') {
        const userInput = prompt(confirmMessage);
        if (userInput !== 'CONFIRM') {
            alert('Restore cancelled.');
            return;
        }
    } else {
        if (!confirm(confirmMessage)) {
            return;
        }
    }

    try {
        // Show loading
        const confirmButton = document.getElementById('confirm-restore-btn');
        const originalText = confirmButton.innerHTML;
        confirmButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Restoring...';
        confirmButton.disabled = true;

        let successCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        if (restoreMode === 'replace') {
            // Delete all existing products
            // First, get all product IDs
            const { data: allProducts } = await supabaseClient
                .from('products')
                .select('product_id');
            
            // Delete each product (this also cascades to inventory_stock due to foreign key)
            if (allProducts && allProducts.length > 0) {
                for (const product of allProducts) {
                    await supabaseClient
                        .from('products')
                        .delete()
                        .eq('product_id', product.product_id);
                }
            }

            // Insert all products from backup
            for (const productData of selectedBackupData.products) {
                try {
                    const { product_name, product_code, unit_of_measure, unit_price, selling_price, 
                            reorder_level, maximum_stock, description, quantity } = productData;

                    // Insert product
                    const { data: newProduct, error: productError } = await supabaseClient
                        .from('products')
                        .insert({
                            product_name,
                            product_code,
                            unit_of_measure,
                            unit_price,
                            selling_price,
                            reorder_level,
                            maximum_stock,
                            description
                        })
                        .select()
                        .single();

                    if (productError) throw productError;

                    // Insert inventory stock
                    const { error: stockError } = await supabaseClient
                        .from('inventory_stock')
                        .insert({
                            product_id: newProduct.product_id,
                            quantity: quantity || 0
                        });

                    if (stockError) throw stockError;

                    successCount++;
                } catch (error) {
                    console.error(`Error restoring product ${productData.product_code}:`, error);
                    errorCount++;
                }
            }

        } else if (restoreMode === 'merge') {
            // Update existing, add new
            for (const productData of selectedBackupData.products) {
                try {
                    const { product_name, product_code, unit_of_measure, unit_price, selling_price, 
                            reorder_level, maximum_stock, description, quantity } = productData;

                    // Check if product exists
                    const { data: existingProducts } = await supabaseClient
                        .from('products')
                        .select('product_id')
                        .eq('product_code', product_code)
                        .limit(1);

                    if (existingProducts && existingProducts.length > 0) {
                        // Update existing product
                        const productId = existingProducts[0].product_id;

                        const { error: updateError } = await supabaseClient
                            .from('products')
                            .update({
                                product_name,
                                unit_of_measure,
                                unit_price,
                                selling_price,
                                reorder_level,
                                maximum_stock,
                                description
                            })
                            .eq('product_id', productId);

                        if (updateError) throw updateError;

                        // Update inventory
                        const { error: stockError } = await supabaseClient
                            .from('inventory_stock')
                            .update({ quantity: quantity || 0 })
                            .eq('product_id', productId);

                        if (stockError) throw stockError;

                    } else {
                        // Insert new product
                        const { data: newProduct, error: productError } = await supabaseClient
                            .from('products')
                            .insert({
                                product_name,
                                product_code,
                                unit_of_measure,
                                unit_price,
                                selling_price,
                                reorder_level,
                                maximum_stock,
                                description
                            })
                            .select()
                            .single();

                        if (productError) throw productError;

                        // Insert inventory stock
                        const { error: stockError } = await supabaseClient
                            .from('inventory_stock')
                            .insert({
                                product_id: newProduct.product_id,
                                quantity: quantity || 0
                            });

                        if (stockError) throw stockError;
                    }

                    successCount++;
                } catch (error) {
                    console.error(`Error restoring product ${productData.product_code}:`, error);
                    errorCount++;
                }
            }

        } else if (restoreMode === 'add-only') {
            // Only add new products, skip existing
            for (const productData of selectedBackupData.products) {
                try {
                    const { product_name, product_code, unit_of_measure, unit_price, selling_price, 
                            reorder_level, maximum_stock, description, quantity } = productData;

                    // Check if product exists
                    const { data: existingProducts } = await supabaseClient
                        .from('products')
                        .select('product_id')
                        .eq('product_code', product_code)
                        .limit(1);

                    if (existingProducts && existingProducts.length > 0) {
                        skippedCount++;
                        continue;
                    }

                    // Insert new product
                    const { data: newProduct, error: productError } = await supabaseClient
                        .from('products')
                        .insert({
                            product_name,
                            product_code,
                            unit_of_measure,
                            unit_price,
                            selling_price,
                            reorder_level,
                            maximum_stock,
                            description
                        })
                        .select()
                        .single();

                    if (productError) throw productError;

                    // Insert inventory stock
                    const { error: stockError } = await supabaseClient
                        .from('inventory_stock')
                        .insert({
                            product_id: newProduct.product_id,
                            quantity: quantity || 0
                        });

                    if (stockError) throw stockError;

                    successCount++;
                } catch (error) {
                    console.error(`Error restoring product ${productData.product_code}:`, error);
                    errorCount++;
                }
            }
        }

        // Show results
        let resultMessage = `✅ Restore completed!\n\n`;
        resultMessage += `✓ Successfully restored: ${successCount} products\n`;
        if (skippedCount > 0) resultMessage += `⊘ Skipped (already exists): ${skippedCount} products\n`;
        if (errorCount > 0) resultMessage += `✗ Errors: ${errorCount} products\n`;

        alert(resultMessage);

        // Reload inventory and close modal
        await loadInventory(getFilters());
        document.getElementById('restore-modal').classList.remove('active');
        resetRestoreModal();

    } catch (error) {
        console.error('Error restoring backup:', error);
        alert('Error restoring backup: ' + error.message);
    } finally {
        // Reset button
        const confirmButton = document.getElementById('confirm-restore-btn');
        confirmButton.innerHTML = '<i class="fas fa-upload"></i> Restore Backup';
        validateRestoreForm();
    }
}

// ========== IMAGE MODAL FUNCTIONS ==========

function openImagePreviewModal(imageUrl, productName) {
    const modal = document.getElementById('image-preview-modal');
    if (!modal) return;
    
    const img = modal.querySelector('.image-modal-content img');
    img.src = imageUrl;
    img.alt = productName;
    
    const title = modal.querySelector('.image-modal-title');
    if (title) title.textContent = productName;
    
    modal.classList.add('active');
}

function closeImagePreviewModal() {
    const modal = document.getElementById('image-preview-modal');
    if (modal) modal.classList.remove('active');
}

function openUploadImageModal(productId) {
    const modal = document.getElementById('upload-image-modal');
    if (!modal) return;
    
    modal.dataset.productId = productId;
    modal.classList.add('active');
    resetImageUploadForm();
}

function closeUploadImageModal() {
    const modal = document.getElementById('upload-image-modal');
    if (modal) modal.classList.remove('active');
}

// ========== IMAGE UPLOAD FUNCTIONS ==========

let selectedImageFile = null;
let selectedImageProductId = null;

function initImageUpload() {
    const fileInput = document.getElementById('product-image-input');
    const uploadArea = document.getElementById('image-upload-area');
    
    if (!uploadArea || !fileInput) return;
    
    // Note: no manual click listener on uploadArea here. The <label for="product-image-input">
    // inside it already opens the native file picker. Adding a second uploadArea.click()
    // listener fires fileInput.click() twice in the same tick (label's native trigger + this
    // listener), which causes the file dialog to immediately close/cancel itself in most
    // browsers — this was why clicking to upload appeared to do nothing.
    
    // File selected
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleImageFileSelect(e.target.files[0]);
        }
    });
    
    // Drag and drop
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        uploadArea.addEventListener(eventName, preventDefaults);
    });
    
    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }
    
    uploadArea.addEventListener('dragover', () => {
        uploadArea.classList.add('drag-over');
    });
    
    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('drag-over');
    });
    
    uploadArea.addEventListener('drop', (e) => {
        uploadArea.classList.remove('drag-over');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleImageFileSelect(files[0]);
        }
    });
}

function handleImageFileSelect(file) {
    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
        showNotification('Invalid file type. Please upload JPG, PNG, or WebP.', 'error');
        return;
    }
    
    // Validate file size (5MB max)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
        showNotification('File too large. Maximum size is 5MB.', 'error');
        return;
    }
    
    selectedImageFile = file;
    displayImagePreview(file);
}

function displayImagePreview(file) {
    const reader = new FileReader();
    
    reader.onload = (e) => {
        const uploadArea = document.getElementById('image-upload-area');
        const previewContainer = document.getElementById('image-preview-container');
        
        if (uploadArea) uploadArea.style.display = 'none';
        
        previewContainer.innerHTML = `
            <div class="image-preview-container">
                <img src="${e.target.result}" alt="Preview" class="image-preview">
                <button type="button" class="remove-image-btn" onclick="removeImagePreview()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <p class="file-info-text">${file.name} (${(file.size / 1024).toFixed(2)} KB)</p>
        `;
        previewContainer.style.display = 'block';
    };
    
    reader.readAsDataURL(file);
}

function removeImagePreview() {
    selectedImageFile = null;
    document.getElementById('product-image-input').value = '';
    document.getElementById('image-preview-container').innerHTML = '';
    document.getElementById('image-preview-container').style.display = 'none';
    document.getElementById('image-upload-area').style.display = 'flex';
}

function resetImageUploadForm() {
    selectedImageFile = null;
    selectedImageProductId = null;
    removeImagePreview();
}

// Upload image to Supabase Storage
async function uploadProductImage() {
    if (!selectedImageFile) {
        showNotification('Please select an image', 'warning');
        return;
    }
    
    const modal = document.getElementById('upload-image-modal');
    const productId = modal.dataset.productId;
    
    if (!productId) {
        showNotification('Product ID not found', 'error');
        return;
    }
    
    try {
        // Show loading state
        const uploadBtn = document.getElementById('confirm-upload-btn');
        const originalText = uploadBtn.innerHTML;
        uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
        uploadBtn.disabled = true;
        
        // Generate unique filename
        const timestamp = Date.now();
        const fileExtension = selectedImageFile.name.split('.').pop();
        const fileName = `product-${productId}-${timestamp}.${fileExtension}`;
        const filePath = `product-images/${fileName}`;
        
        // Upload to Supabase Storage
        const { data, error: uploadError } = await supabaseClient.storage
            .from('product-images')
            .upload(filePath, selectedImageFile, {
                cacheControl: '3600',
                upsert: false
            });
        
        if (uploadError) throw uploadError;
        
        // Get public URL
        const { data: publicUrlData } = supabaseClient.storage
            .from('product-images')
            .getPublicUrl(filePath);
        
        const imageUrl = publicUrlData.publicUrl;
        
        // Update product in database
        const { error: updateError } = await supabaseClient
            .from('products')
            .update({
                image_url: imageUrl,
                image_path: filePath,
                image_uploaded_at: new Date().toISOString()
            })
            .eq('product_id', productId);
        
        if (updateError) throw updateError;
        
        // Success
        if (currentEditingProductId) {
            updateProductThumbnailPreview({
                image_url: imageUrl,
                product_name: document.getElementById('product-name')?.value || 'Product thumbnail'
            });
        }

        showNotification('Image uploaded successfully!', 'success');
        closeUploadImageModal();
        await loadInventory(getFilters());
        
    } catch (error) {
        console.error('Error uploading image:', error);
        showNotification('Failed to upload image: ' + error.message, 'error');
    } finally {
        const uploadBtn = document.getElementById('confirm-upload-btn');
        uploadBtn.innerHTML = '<i class="fas fa-upload"></i> Upload Image';
        uploadBtn.disabled = false;
    }
}

// Helper notification function (if you don't have one already)
function showNotification(message, type = 'info') {
    // Create a simple toast notification
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 16px 20px;
        border-radius: 6px;
        background-color: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#3b82f6'};
        color: white;
        font-size: 14px;
        z-index: 2000;
        animation: slideIn 0.3s ease;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}