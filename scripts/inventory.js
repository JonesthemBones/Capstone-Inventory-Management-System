let currentEditingProductId = null;
let currentAdjustingProductId = null;
let currentUserRole = null;
let inventoryProducts = [];
let generatedReorderItems = [];
let inventoryCategories = [];
let filteredInventoryProducts = [];
let inventoryCurrentPage = 1;
let inventoryPageSize = 25;

document.addEventListener('DOMContentLoaded', async () => {
    const session = await window.authHelpers.requireAuth();
    if (!session) return;
    
    // Get current user role
    await loadUserRole();
    
    // Apply role-based access controls
    applyRoleBasedAccess();
    window.authHelpers.revealProtectedContent();
    
    await loadInventoryCategories();
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
    // Staff and cashiers have a read-only inventory catalog.
    if (currentUserRole === 'staff' || currentUserRole === 'cashier') {
        const title = document.querySelector('.page-title');
        const subtitle = document.querySelector('.page-subtitle');
        if (title) title.textContent = currentUserRole === 'cashier' ? 'Inventory Lookup' : 'Inventory Catalog';
        if (subtitle) subtitle.textContent = 'View product availability and current stock levels (read-only)';
        const backupRestoreButtons = document.querySelectorAll('.role-backup-restore');
        backupRestoreButtons.forEach(btn => {
            btn.style.display = 'none';
        });
    }
    
    if (currentUserRole === 'cashier' || currentUserRole === 'staff') {
        const staffButtons = document.querySelectorAll('.role-requires-staff-or-admin');
        staffButtons.forEach(btn => {
            btn.style.display = 'none';
        });
    }
}

function normalizeInboundPrice(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : value;
}

function detectInboundPriceMismatch(movements) {
    if (!Array.isArray(movements) || movements.length <= 1) {
        return { hasMismatch: false, fields: [] };
    }

    const latestMovement = movements[0];
    const latestPrices = {
        unit_price: normalizeInboundPrice(latestMovement.unit_price),
        selling_price: normalizeInboundPrice(latestMovement.selling_price)
    };
    const differentFields = new Set();

    movements.slice(1).forEach(movement => {
        ['unit_price', 'selling_price'].forEach(field => {
            if (normalizeInboundPrice(movement[field]) !== latestPrices[field]) {
                differentFields.add(field);
            }
        });
    });

    return {
        hasMismatch: differentFields.size > 0,
        fields: Array.from(differentFields)
    };
}

function getInventoryQuantity(product) {
    const inventory = product.inventory_stock?.[0] || product.inventory_stock || product.inventory?.[0] || {};
    return Number(inventory.quantity || 0);
}

function getProductStockStatus(product) {
    const quantity = getInventoryQuantity(product);
    const maximumStock = Number(product.maximum_stock || 0);
    const reorderLevel = Math.max(0, Number(product.reorder_level ?? 10));
    const lowThreshold = maximumStock > 0 ? Math.ceil(maximumStock * 0.25) : reorderLevel;
    const criticalThreshold = maximumStock > 0
        ? Math.ceil(maximumStock * 0.10)
        : (reorderLevel > 0 ? Math.max(1, Math.ceil(reorderLevel * 0.40)) : 0);

    if (quantity <= 0) return 'out_of_stock';
    if (maximumStock > 0 && quantity > maximumStock) return 'overstocked';
    if (criticalThreshold > 0 && quantity <= criticalThreshold) return 'critical';
    if (lowThreshold > 0 && quantity <= lowThreshold) return 'low_stock';
    return 'in_stock';
}

const normalizeUnit = unit => String(unit || '').trim().toUpperCase();

function setProductUnitValue(unit) {
    const select = document.getElementById('product-unit');
    const normalizedUnit = normalizeUnit(unit);

    if (!select || !normalizedUnit) {
        if (select) select.value = '';
        return;
    }

    const matchingOption = Array.from(select.options).find(option =>
        normalizeUnit(option.value) === normalizedUnit
    );

    if (matchingOption) {
        select.value = matchingOption.value;
        return;
    }

    // Imported or restored products may use a valid unit that is not in the
    // standard list. Preserve it so the edit form does not silently clear it.
    select.add(new Option(normalizedUnit, normalizedUnit));
    select.value = normalizedUnit;
}

function updateInventoryUnitOptions(products) {
    const select = document.getElementById('unit-filter');
    if (!select) return;
    const selected = normalizeUnit(select.value);
    const units = [...new Set((products || []).map(product => normalizeUnit(product.unit_of_measure)).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
    select.replaceChildren(new Option('All Units', ''), ...units.map(unit => new Option(unit, unit)));
    if (units.includes(selected)) select.value = selected;
}

async function loadInventoryCategories() {
    const filterSelect = document.getElementById('category-filter');
    const productSelect = document.getElementById('product-category');
    if (!filterSelect && !productSelect) return;

    try {
        const { data, error } = await supabaseClient
            .from('categories')
            .select('category_id, category_name')
            .eq('is_active', true)
            .order('category_name');

        if (error) throw error;
        inventoryCategories = data || [];
        if (filterSelect) {
            filterSelect.replaceChildren(
                new Option('All Categories', ''),
                ...inventoryCategories.map(category => new Option(category.category_name, category.category_id))
            );
        }
        if (productSelect) {
            productSelect.replaceChildren(
                new Option('Select Category', ''),
                ...inventoryCategories.map(category => new Option(category.category_name, category.category_id))
            );
        }
    } catch (error) {
        console.error('Error loading inventory categories:', error);
    }
}

function filterAndSortInventory(products, filters) {
    const hasNumber = value => value !== '' && value !== null && value !== undefined;
    const result = (products || []).filter(product => {
        const quantity = getInventoryQuantity(product);
        const price = Number(product.selling_price || 0);
        const isActive = product.is_active !== false;
        if (filters.category && String(product.category_id || '') !== String(filters.category)) return false;
        if (filters.status && getProductStockStatus(product) !== filters.status) return false;
        if (filters.unit && String(product.unit_of_measure || '').trim().toUpperCase() !== String(filters.unit).trim().toUpperCase()) return false;
        if (filters.active === 'active' && !isActive) return false;
        if (filters.active === 'inactive' && isActive) return false;
        if (hasNumber(filters.minQuantity) && quantity < Number(filters.minQuantity)) return false;
        if (hasNumber(filters.maxQuantity) && quantity > Number(filters.maxQuantity)) return false;
        if (hasNumber(filters.minPrice) && price < Number(filters.minPrice)) return false;
        if (hasNumber(filters.maxPrice) && price > Number(filters.maxPrice)) return false;
        return true;
    });

    const sorters = {
        name_asc: (a, b) => String(a.product_name || '').localeCompare(String(b.product_name || '')),
        name_desc: (a, b) => String(b.product_name || '').localeCompare(String(a.product_name || '')),
        quantity_asc: (a, b) => getInventoryQuantity(a) - getInventoryQuantity(b),
        quantity_desc: (a, b) => getInventoryQuantity(b) - getInventoryQuantity(a),
        price_asc: (a, b) => Number(a.selling_price || 0) - Number(b.selling_price || 0),
        price_desc: (a, b) => Number(b.selling_price || 0) - Number(a.selling_price || 0),
        value_desc: (a, b) => (getInventoryQuantity(b) * Number(b.unit_price || 0)) - (getInventoryQuantity(a) * Number(a.unit_price || 0))
    };
    return result.sort(sorters[filters.sort] || sorters.name_asc);
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

        const { data: inboundMovements, error: movementsError } = await supabaseClient
            .from('stock_movements')
            .select('movement_id, product_id, quantity_change, unit_price, selling_price, movement_date, reference_type, notes')
            .eq('movement_type', 'inbound')
            .order('movement_date', { ascending: false });

        if (movementsError) {
            console.error('Stock Movements Query Error:', movementsError);
            throw movementsError;
        }

        const inboundMovementsByProductId = (inboundMovements || []).reduce((lookup, movement) => {
            if (!lookup[movement.product_id]) {
                lookup[movement.product_id] = [];
            }
            lookup[movement.product_id].push(movement);
            return lookup;
        }, {});

        (products || []).forEach(product => {
            product.inbound_movements = inboundMovementsByProductId[product.product_id] || [];
        });

        inventoryProducts = products || [];

        updateInventoryUnitOptions(products);
        const filteredProducts = filterAndSortInventory(products, filters);
        filteredInventoryProducts = filteredProducts;

        await backfillMissingProductCodes(filteredProducts);
        renderInventoryPage();
        
    } catch (error) {
        console.error('Error loading inventory:', error);
    }
}

async function backfillMissingProductCodes(products) {
    if (currentUserRole === 'cashier' || currentUserRole === 'staff') {
        return;
    }

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

function parseBatchPrice(value) {
    if (value.trim() === '') return null;
    const price = Number(value);
    if (!Number.isFinite(price) || price < 0) {
        throw new Error('Prices must be valid non-negative numbers.');
    }
    return price;
}

function renderBatchMovementEditRow(movement) {
    return `
        <td>${movement.movement_date ? new Date(movement.movement_date).toLocaleString() : 'N/A'}</td>
        <td>${movement.reference_type || 'N/A'}</td>
        <td>${movement.quantity_change ?? 0}</td>
        <td><input class="batch-price-input" type="number" min="0" step="0.01" data-field="unit_price" value="${movement.unit_price ?? ''}"></td>
        <td><input class="batch-price-input" type="number" min="0" step="0.01" data-field="selling_price" value="${movement.selling_price ?? ''}"></td>
        <td>${movement.notes || ''}</td>
        <td class="batch-actions-cell">
            <button type="button" class="icon-btn batch-save-btn" title="Save batch prices" aria-label="Save batch prices">
                <i class="fas fa-check"></i>
            </button>
            <button type="button" class="icon-btn batch-cancel-btn" title="Cancel batch edit" aria-label="Cancel batch edit">
                <i class="fas fa-times"></i>
            </button>
        </td>
    `;
}

async function saveBatchMovementPrices(product, movement, row) {
    const unitPriceInput = row.querySelector('[data-field="unit_price"]');
    const sellingPriceInput = row.querySelector('[data-field="selling_price"]');
    const unitPrice = parseBatchPrice(unitPriceInput.value);
    const sellingPrice = parseBatchPrice(sellingPriceInput.value);

    const { error } = await supabaseClient
        .from('stock_movements')
        .update({ unit_price: unitPrice, selling_price: sellingPrice })
        .eq('movement_id', movement.movement_id);

    if (error) throw error;

    movement.unit_price = unitPrice;
    movement.selling_price = sellingPrice;

    if (product.inbound_movements?.[0]?.movement_id === movement.movement_id) {
        const { error: productError } = await supabaseClient
            .from('products')
            .update({ unit_price: unitPrice, selling_price: sellingPrice })
            .eq('product_id', product.product_id);

        if (productError) throw productError;
    }

    await loadInventory(getFilters());
}

function renderInboundBatchHistory(product, batchRow) {
    const movements = Array.isArray(product.inbound_movements) ? product.inbound_movements : [];
    const batchCell = batchRow.querySelector('.batch-history-cell');

    if (!batchCell) return;
    if (movements.length === 0) {
        batchCell.innerHTML = '<div class="batch-history-empty">No stock receipts found.</div>';
        return;
    }

    const latestMovement = movements[0];
    batchCell.innerHTML = `
        <table class="batch-history-table">
            <thead>
                <tr>
                    <th>Date Added</th>
                    <th>Source</th>
                    <th>Quantity</th>
                    <th>Cost per Unit</th>
                    <th>Selling Price</th>
                    <th>Notes</th>
                    ${currentUserRole !== 'cashier' ? '<th>Actions</th>' : ''}
                </tr>
            </thead>
            <tbody>
                ${movements.map(movement => {
                    const unitPriceMismatch = normalizeInboundPrice(movement.unit_price) !== normalizeInboundPrice(latestMovement.unit_price);
                    const sellingPriceMismatch = normalizeInboundPrice(movement.selling_price) !== normalizeInboundPrice(latestMovement.selling_price);
                    const dateAdded = movement.movement_date
                        ? new Date(movement.movement_date).toLocaleString()
                        : 'N/A';

                    return `
                        <tr data-movement-id="${movement.movement_id}">
                            <td>${dateAdded}</td>
                            <td>${movement.reference_type || 'N/A'}</td>
                            <td>${movement.quantity_change ?? 0}</td>
                            <td class="${unitPriceMismatch ? 'batch-price-mismatch' : ''}">${formatCurrency(movement.unit_price || 0)}</td>
                            <td class="${sellingPriceMismatch ? 'batch-price-mismatch' : ''}">${formatCurrency(movement.selling_price || 0)}</td>
                            <td>${movement.notes || ''}</td>
                            ${currentUserRole !== 'cashier' ? '<td class="batch-actions-cell"><button type="button" class="icon-btn batch-edit-btn" title="Edit batch prices" aria-label="Edit batch prices"><i class="fas fa-pen"></i></button></td>' : ''}
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;

    batchCell.querySelectorAll('.batch-edit-btn').forEach(button => {
        button.addEventListener('click', () => {
            const row = button.closest('tr');
            const movement = product.inbound_movements?.find(item => item.movement_id === row?.dataset.movementId);
            if (!row || !movement) return;

            row.innerHTML = renderBatchMovementEditRow(movement);
            row.querySelector('.batch-save-btn').addEventListener('click', async () => {
                try {
                    await saveBatchMovementPrices(product, movement, row);
                } catch (error) {
                    alert('Error saving batch prices: ' + error.message);
                }
            });
            row.querySelector('.batch-cancel-btn').addEventListener('click', () => {
                renderInboundBatchHistory(product, row.closest('.batch-history-row'));
            });
        });
    });
}

function setupBatchHistoryToggles(products) {
    const productsById = new Map(products.map(product => [product.product_id, product]));

    document.querySelectorAll('.batch-toggle-btn').forEach(button => {
        button.addEventListener('click', () => {
            const productId = button.dataset.productId;
            const batchRow = document.getElementById(`batch-history-${productId}`);
            const product = productsById.get(productId);
            if (!batchRow || !product) return;

            const isOpening = batchRow.hidden;
            if (isOpening && !batchRow.dataset.rendered) {
                renderInboundBatchHistory(product, batchRow);
                batchRow.dataset.rendered = 'true';
            }

            batchRow.hidden = !isOpening;
            button.setAttribute('aria-expanded', String(isOpening));
            button.setAttribute('aria-label', `${isOpening ? 'Hide' : 'Show'} batch history`);
            button.title = `${isOpening ? 'Hide' : 'Show'} batch history`;
            const icon = button.querySelector('i');
            if (icon) {
                icon.classList.remove('fa-chevron-down');
                icon.classList.add('fa-chevron-right');
            }
        });
    });

}

function displayInventory(products) {
    const tbody = document.getElementById('inventory-table-body');
    renderMobileInventoryCards(products);
    
    if (!products || products.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11" style="text-align: center; padding: 40px; color: var(--text-secondary);">
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
        const latestSellingPrice = product.inbound_movements?.[0]?.selling_price ?? product.selling_price ?? 0;
        const priceMismatch = detectInboundPriceMismatch(product.inbound_movements);
        const unitCostMismatchBadge = priceMismatch.fields.includes('unit_price')
            ? '<span class="price-mismatch-badge unit-cost-mismatch-badge" title="Inbound batches have different unit costs"><i class="fas fa-triangle-exclamation"></i> Unit cost varies</span>'
            : '';
        const sellingPriceMismatchBadge = priceMismatch.fields.includes('selling_price')
            ? '<span class="price-mismatch-badge selling-price-mismatch-badge" title="Inbound batches have different selling prices"><i class="fas fa-triangle-exclamation"></i> Selling price varies</span>'
            : '';
        
        console.log(`Displaying ${product.product_name}:`, {
            quantity: quantity
        });
        
        let status = getProductStockStatus(product);
        let statusClass = 'status-out';
        let statusText = 'Out of Stock';

        if (status === 'in_stock') {
            statusClass = 'status-in';
            statusText = 'In Stock';
        } else if (status === 'low_stock') {
            statusClass = 'status-low';
            statusText = 'Low Stock';
        } else if (status === 'critical') {
            statusClass = 'status-critical';
            statusText = 'Critical';
        } else if (status === 'overstocked') {
            statusClass = 'status-over';
            statusText = 'Overstocked';
        }
        
        // Generate action buttons based on role
        let actionButtons = '';
        if (currentUserRole === 'cashier' || currentUserRole === 'staff') {
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
        } else if (currentUserRole === 'cashier' || currentUserRole === 'staff') {
            thumbnailCell = `
                <td class="product-thumbnail-cell">
                    <div class="product-thumbnail-placeholder" title="No product image available">
                        <i class="fas fa-image"></i>
                    </div>
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
                <td>
                    <button type="button" class="icon-btn batch-toggle-btn" data-product-id="${product.product_id}" aria-expanded="false" aria-label="Show batch history" title="Show batch history">
                        <i class="fas fa-chevron-right"></i>
                    </button>
                </td>
                ${thumbnailCell}
                <td><strong class="product-name">${product.product_name}</strong></td>
                <td>${product.product_code || 'N/A'}</td>
                <td>${product.unit_of_measure || 'N/A'}</td>
                <td><strong>${quantity}</strong></td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                <td>${formatCurrency(product.unit_price || 0)}${unitCostMismatchBadge}</td>
                <td>${formatCurrency(latestSellingPrice)}${sellingPriceMismatchBadge}</td>
                <td><strong>${formatCurrency(totalValue)}</strong></td>
                <td>
                    ${actionButtons}
                </td>
            </tr>
            <tr id="batch-history-${product.product_id}" class="batch-history-row" data-product-id="${product.product_id}" hidden>
                <td colspan="11" class="batch-history-cell"></td>
            </tr>
        `;
    }).join('');
    
    // Only attach mutation listeners for inventory managers.
    if (currentUserRole !== 'cashier' && currentUserRole !== 'staff') {
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

    setupBatchHistoryToggles(products);
}

function escapeInventoryHTML(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
}

function getInventoryStatusMeta(product) {
    const status = getProductStockStatus(product);
    const statuses = {
        in_stock: { className: 'status-in', label: 'In Stock' },
        low_stock: { className: 'status-low', label: 'Low Stock' },
        critical: { className: 'status-critical', label: 'Critical' },
        overstocked: { className: 'status-over', label: 'Overstocked' },
        out_of_stock: { className: 'status-out', label: 'Out of Stock' }
    };
    return statuses[status] || statuses.out_of_stock;
}

function renderMobileInventoryCards(products) {
    const grid = document.getElementById('inventory-mobile-grid');
    if (!grid) return;

    if (!products?.length) {
        grid.innerHTML = `
            <div class="inventory-mobile-empty">
                <i class="fas fa-box-open"></i>
                <strong>No products found</strong>
                <span>Try changing your search or filters.</span>
            </div>`;
        return;
    }

    const canManage = currentUserRole !== 'cashier' && currentUserRole !== 'staff';
    grid.innerHTML = products.map(product => {
        const quantity = getInventoryQuantity(product);
        const unitPrice = Number(product.unit_price || 0);
        const sellingPrice = Number(product.inbound_movements?.[0]?.selling_price ?? product.selling_price ?? 0);
        const totalValue = quantity * unitPrice;
        const status = getInventoryStatusMeta(product);
        const safeId = escapeInventoryHTML(product.product_id);
        const safeName = escapeInventoryHTML(product.product_name || 'Unnamed product');
        const safeCode = escapeInventoryHTML(product.product_code || 'N/A');
        const safeUnit = escapeInventoryHTML(product.unit_of_measure || 'N/A');
        const safeImage = escapeInventoryHTML(product.image_url || '');
        const image = product.image_url
            ? `<button type="button" class="inventory-card-image-button" data-image-url="${safeImage}" data-image-name="${safeName}" aria-label="View image for ${safeName}">
                    <img src="${safeImage}" alt="${safeName}" loading="lazy">
               </button>`
            : `<div class="inventory-card-image-placeholder"><i class="fas fa-image"></i></div>`;
        const actions = canManage
            ? `<div class="inventory-card-actions" aria-label="Actions for ${safeName}">
                    <button type="button" class="btn inventory-card-action inventory-card-delete delete-btn" data-id="${safeId}" aria-label="Delete ${safeName}"><i class="fas fa-trash"></i> Delete</button>
                    <button type="button" class="btn inventory-card-action edit-btn" data-id="${safeId}"><i class="fas fa-edit"></i> Edit</button>
                    <button type="button" class="btn inventory-card-action adjust-btn" data-id="${safeId}"><i class="fas fa-boxes"></i> Adjust</button>
               </div>`
            : '<span class="inventory-card-readonly"><i class="fas fa-eye"></i> View only</span>';

        return `
            <article class="inventory-mobile-card" data-product-id="${safeId}">
                <div class="inventory-card-top">
                    ${image}
                    <div class="inventory-card-identity">
                        <span class="status-badge ${status.className}">${status.label}</span>
                        <h3 class="product-name">${safeName}</h3>
                        <span class="inventory-card-code">${safeCode}</span>
                    </div>
                </div>
                <div class="inventory-card-summary">
                    <div><span>Available</span><strong>${quantity} ${safeUnit}</strong></div>
                    <div><span>Selling price</span><strong>${formatCurrency(sellingPrice)}</strong></div>
                </div>
                <div class="inventory-card-details">
                    <dl>
                        <div><dt>Unit cost</dt><dd>${formatCurrency(unitPrice)}</dd></div>
                        <div><dt>Stock value</dt><dd>${formatCurrency(totalValue)}</dd></div>
                        <div><dt>Low-stock alert at</dt><dd>${Number(product.reorder_level || 0)} ${safeUnit}</dd></div>
                        <div><dt>Maximum stock</dt><dd>${Number(product.maximum_stock || 0)} ${safeUnit}</dd></div>
                    </dl>
                </div>
                <div class="inventory-card-footer">${actions}</div>
            </article>`;
    }).join('');

    grid.querySelectorAll('.inventory-card-image-button').forEach(button => {
        button.addEventListener('click', () => openImagePreviewModal(button.dataset.imageUrl, button.dataset.imageName));
    });
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
    const reloadInventory = debounce(() => loadInventory(getFilters()), 250);
    const filtersChanged = () => {
        inventoryCurrentPage = 1;
        updateInventoryFilterControls();
        reloadInventory();
    };

    document.getElementById('inventory-search').addEventListener('input', filtersChanged);
    ['category-filter', 'status-filter', 'unit-filter', 'active-filter', 'inventory-sort'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', filtersChanged);
    });
    ['min-quantity-filter', 'max-quantity-filter', 'min-price-filter', 'max-price-filter'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', filtersChanged);
    });
    document.getElementById('toggle-advanced-filters')?.addEventListener('click', toggleAdvancedInventoryFilters);
    document.getElementById('reset-inventory-filters')?.addEventListener('click', () => {
        ['inventory-search', 'category-filter', 'status-filter', 'unit-filter', 'active-filter', 'min-quantity-filter',
            'max-quantity-filter', 'min-price-filter', 'max-price-filter'].forEach(id => {
            const element = document.getElementById(id);
            if (element) element.value = '';
        });
        document.getElementById('inventory-sort').value = 'name_asc';
        inventoryCurrentPage = 1;
        updateInventoryFilterControls();
        loadInventory(getFilters());
    });
    document.getElementById('inventory-page-size')?.addEventListener('change', event => {
        inventoryPageSize = Number(event.target.value) || 25;
        inventoryCurrentPage = 1;
        renderInventoryPage();
    });
    document.getElementById('inventory-prev-page')?.addEventListener('click', () => changeInventoryPage(-1));
    document.getElementById('inventory-next-page')?.addEventListener('click', () => changeInventoryPage(1));
    updateInventoryFilterControls();

    document.getElementById('generate-reorder-btn')?.addEventListener('click', openReorderModal);
    document.getElementById('close-reorder-modal')?.addEventListener('click', closeReorderModal);
    document.getElementById('cancel-reorder-btn')?.addEventListener('click', closeReorderModal);
    document.getElementById('print-reorder-btn')?.addEventListener('click', printReorderList);
    document.getElementById('reorder-table-body')?.addEventListener('change', updateReorderQuantity);

    document.getElementById('product-form').addEventListener('submit', saveProduct);
    document.getElementById('new-product-thumbnail-input')?.addEventListener('change', handleNewProductThumbnailSelect);

    document.getElementById('add-item-btn').addEventListener('click', () => {
        currentEditingProductId = null;
        document.getElementById('modal-title').textContent = 'Add New Product';
        document.getElementById('product-form').reset();
        pendingNewProductImageFile = null;
        toggleProductThumbnailSection(true);
        updateProductThumbnailPreview(null);
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
        category: document.getElementById('category-filter').value,
        status: document.getElementById('status-filter').value,
        unit: document.getElementById('unit-filter').value,
        active: document.getElementById('active-filter').value,
        minQuantity: document.getElementById('min-quantity-filter').value,
        maxQuantity: document.getElementById('max-quantity-filter').value,
        minPrice: document.getElementById('min-price-filter').value,
        maxPrice: document.getElementById('max-price-filter').value,
        sort: document.getElementById('inventory-sort').value
    };
}

function getAdvancedFilterCount() {
    const hasValue = id => Boolean(document.getElementById(id)?.value);
    return Number(hasValue('unit-filter'))
        + Number(hasValue('active-filter'))
        + Number(hasValue('min-quantity-filter') || hasValue('max-quantity-filter'))
        + Number(hasValue('min-price-filter') || hasValue('max-price-filter'));
}

function updateInventoryFilterControls() {
    const filters = getFilters();
    const advancedCount = getAdvancedFilterCount();
    const countBadge = document.getElementById('advanced-filter-count');
    const clearButton = document.getElementById('reset-inventory-filters');
    const hasAnyFilter = Boolean(filters.search.trim() || filters.category || filters.status || advancedCount || filters.sort !== 'name_asc');

    if (countBadge) {
        countBadge.textContent = advancedCount;
        countBadge.hidden = advancedCount === 0;
    }
    if (clearButton) clearButton.hidden = !hasAnyFilter;
}

function toggleAdvancedInventoryFilters() {
    const button = document.getElementById('toggle-advanced-filters');
    const panel = document.getElementById('advanced-inventory-filters');
    const label = document.getElementById('advanced-filter-toggle-label');
    if (!button || !panel) return;

    const willOpen = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(willOpen));
    panel.hidden = !willOpen;
    if (label) label.textContent = willOpen ? 'Hide Filters' : 'More Filters';
}

function renderInventoryPage() {
    const totalItems = filteredInventoryProducts.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / inventoryPageSize));
    inventoryCurrentPage = Math.min(Math.max(1, inventoryCurrentPage), totalPages);

    const startIndex = (inventoryCurrentPage - 1) * inventoryPageSize;
    const pageProducts = filteredInventoryProducts.slice(startIndex, startIndex + inventoryPageSize);
    const shownFrom = totalItems ? startIndex + 1 : 0;
    const shownTo = Math.min(startIndex + inventoryPageSize, totalItems);

    displayInventory(pageProducts);
    document.getElementById('inventory-count').textContent = `${totalItems} items in inventory`;
    document.getElementById('inventory-page-info').textContent = totalItems
        ? `Showing ${shownFrom}–${shownTo} of ${totalItems} items`
        : 'Showing 0 items';
    document.getElementById('inventory-page-number').textContent = `Page ${inventoryCurrentPage} of ${totalPages}`;
    document.getElementById('inventory-prev-page').disabled = inventoryCurrentPage <= 1;
    document.getElementById('inventory-next-page').disabled = inventoryCurrentPage >= totalPages;
}

function changeInventoryPage(direction) {
    const totalPages = Math.max(1, Math.ceil(filteredInventoryProducts.length / inventoryPageSize));
    const nextPage = Math.min(Math.max(1, inventoryCurrentPage + direction), totalPages);
    if (nextPage === inventoryCurrentPage) return;
    inventoryCurrentPage = nextPage;
    renderInventoryPage();
    document.querySelector('.inventory-filter-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function buildReorderItems() {
    return inventoryProducts
        .filter(product => product.is_active !== false && ['low_stock', 'critical', 'out_of_stock'].includes(getProductStockStatus(product)))
        .map(product => {
            const onHand = getInventoryQuantity(product);
            const reorderLevel = Math.max(0, Number(product.reorder_level || 0));
            const maximumStock = Math.max(0, Number(product.maximum_stock || 0));
            const target = maximumStock > onHand ? maximumStock : Math.max(reorderLevel * 2, reorderLevel, onHand);
            return {
                productId: product.product_id,
                name: product.product_name || 'Unnamed product',
                code: product.product_code || 'N/A',
                unit: product.unit_of_measure || 'unit',
                status: getProductStockStatus(product),
                onHand,
                target,
                quantity: Math.max(0, target - onHand),
                unitCost: Math.max(0, Number(product.unit_price || 0))
            };
        })
        .filter(item => item.quantity > 0)
        .sort((a, b) => ({ out_of_stock: 0, critical: 1, low_stock: 2 }[a.status] - { out_of_stock: 0, critical: 1, low_stock: 2 }[b.status]) || a.name.localeCompare(b.name));
}

function reorderStatusLabel(status) {
    return { low_stock: 'Low Stock', critical: 'Critical', out_of_stock: 'Out of Stock' }[status] || status;
}

function formatPeso(value) {
    return `\u20B1${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function renderReorderList() {
    const body = document.getElementById('reorder-table-body');
    const empty = document.getElementById('reorder-empty');
    const printButton = document.getElementById('print-reorder-btn');
    const total = generatedReorderItems.reduce((sum, item) => sum + (item.quantity * item.unitCost), 0);
    const totalUnits = generatedReorderItems.reduce((sum, item) => sum + item.quantity, 0);

    body.innerHTML = generatedReorderItems.map((item, index) => `
        <tr>
            <td data-label="Product"><strong>${escapeInventoryHTML(item.name)}</strong><small class="reorder-unit">${escapeInventoryHTML(item.unit)}</small></td>
            <td data-label="Code" class="reorder-code">${escapeInventoryHTML(item.code)}</td>
            <td data-label="Status"><span class="status-badge status-${item.status === 'low_stock' ? 'low' : item.status === 'critical' ? 'critical' : 'out'}">${reorderStatusLabel(item.status)}</span></td>
            <td data-label="On hand">${item.onHand}</td><td data-label="Target">${item.target}</td>
            <td data-label="Order qty"><input class="reorder-quantity" type="number" min="0" step="1" value="${item.quantity}" data-index="${index}" aria-label="Order quantity for ${escapeInventoryHTML(item.name)}"></td>
            <td data-label="Est. cost"><strong>${formatPeso(item.quantity * item.unitCost)}</strong></td>
        </tr>`).join('');
    empty.hidden = generatedReorderItems.length > 0;
    document.querySelector('.reorder-table-wrap').hidden = generatedReorderItems.length === 0;
    printButton.disabled = generatedReorderItems.length === 0;
    document.getElementById('reorder-summary').innerHTML = `<span><strong>${generatedReorderItems.length}</strong> products</span><span><strong>${totalUnits}</strong> units to order</span><span>Estimated total <strong>${formatPeso(total)}</strong></span>`;
}

function openReorderModal() {
    if (!['owner', 'admin', 'manager'].includes(String(currentUserRole).toLowerCase())) {
        alert('Only an owner, admin, or manager can create a restock list.');
        return;
    }
    generatedReorderItems = buildReorderItems();
    renderReorderList();
    document.getElementById('reorder-modal').classList.add('active');
    document.body.classList.add('modal-open');
}

function closeReorderModal() {
    document.getElementById('reorder-modal')?.classList.remove('active');
    document.body.classList.remove('modal-open');
}

function updateReorderQuantity(event) {
    const input = event.target.closest('.reorder-quantity');
    if (!input) return;
    const index = Number(input.dataset.index);
    generatedReorderItems[index].quantity = Math.max(0, Math.floor(Number(input.value) || 0));
    renderReorderList();
}

function printReorderList() {
    const items = generatedReorderItems.filter(item => item.quantity > 0);
    if (!items.length) return;
    const estimatedTotal = items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
    const documentNumber = `RO-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
    const rows = items.map(item => `<tr><td>${escapeInventoryHTML(item.name)}</td><td>${escapeInventoryHTML(item.code)}</td><td>${reorderStatusLabel(item.status)}</td><td>${item.onHand} ${escapeInventoryHTML(item.unit)}</td><td>${item.quantity} ${escapeInventoryHTML(item.unit)}</td><td>${formatPeso(item.unitCost)}</td><td>${formatPeso(item.quantity * item.unitCost)}</td></tr>`).join('');
    const printWindow = window.open('', '_blank', 'width=1000,height=750');
    if (!printWindow) return alert('Allow pop-ups to print the restock list.');
    printWindow.document.write(`<!doctype html><html><head><title>${documentNumber}</title><style>body{font-family:Arial,sans-serif;color:#111;padding:32px}h1{margin:0}header{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:16px;margin-bottom:24px}.meta{text-align:right;font-size:13px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #bbb;padding:8px;text-align:left}th{background:#eee}.total{text-align:right;font-size:16px;font-weight:bold;margin-top:18px}.signatures{display:flex;justify-content:space-between;margin-top:70px}.signature{width:220px;border-top:1px solid #111;padding-top:6px;text-align:center;font-size:12px}@media print{body{padding:0}}</style></head><body><header><div><h1>AMACAR HARDWARE</h1><p>Inventory Restock List</p></div><div class="meta"><strong>${documentNumber}</strong><br>${new Date().toLocaleString('en-PH')}<br>Prepared by: ${escapeInventoryHTML(String(currentUserRole).toUpperCase())}</div></header><table><thead><tr><th>Product</th><th>Code</th><th>Priority</th><th>In Stock</th><th>Order Quantity</th><th>Cost per Unit</th><th>Estimated Cost</th></tr></thead><tbody>${rows}</tbody></table><p class="total">Estimated Total: ${formatPeso(estimatedTotal)}</p><div class="signatures"><div class="signature">Prepared by</div><div class="signature">Approved by</div><div class="signature">Supplier acknowledgment</div></div><script>window.onload=()=>window.print()<\/script></body></html>`);
    printWindow.document.close();
}

function toggleProductThumbnailSection(show) {
    const section = document.getElementById('product-thumbnail-section');
    const button = document.getElementById('change-product-thumbnail-btn');
    const buttonLabel = document.getElementById('product-thumbnail-button-label');
    const help = document.getElementById('product-thumbnail-help');

    if (!section) return;

    section.style.display = show ? 'block' : 'none';
    if (button) {
        button.disabled = !show;
    }
    if (buttonLabel) buttonLabel.textContent = currentEditingProductId ? 'Change Thumbnail' : 'Add Thumbnail';
    if (help) help.textContent = currentEditingProductId
        ? 'Update the item image whenever you edit this product.'
        : 'Optional. JPG, PNG or WebP (Max 5MB).';
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
        document.getElementById('new-product-thumbnail-input')?.click();
        return;
    }

    openUploadImageModal(currentEditingProductId);
}

let pendingNewProductImageFile = null;

function handleNewProductThumbnailSelect(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const validationError = validateProductImageFile(file);
    if (validationError) {
        showNotification(validationError, 'error');
        event.target.value = '';
        return;
    }

    pendingNewProductImageFile = file;
    const reader = new FileReader();
    reader.onload = () => updateProductThumbnailPreview({
        image_url: reader.result,
        product_name: document.getElementById('product-name')?.value || 'New product thumbnail'
    });
    reader.readAsDataURL(file);
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
    let thumbnailUploadError = null;
    
    const productData = {
        product_name: document.getElementById('product-name').value.trim().toUpperCase(),
        product_code: document.getElementById('product-code').value.trim(),
        category_id: document.getElementById('product-category').value,
        unit_of_measure: normalizeUnit(document.getElementById('product-unit').value),
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

            if (pendingNewProductImageFile) {
                try {
                    await saveProductImageFile(pendingNewProductImageFile, productId);
                } catch (error) {
                    thumbnailUploadError = error;
                    console.error('Product saved, but thumbnail upload failed:', error);
                }
                pendingNewProductImageFile = null;
            }
        }
        
        document.getElementById('product-modal').classList.remove('active');
        await loadInventory(getFilters());
        if (thumbnailUploadError) {
            alert('Product added successfully, but its thumbnail could not be uploaded: ' + thumbnailUploadError.message);
        } else {
            alert(currentEditingProductId ? 'Product updated successfully!' : 'Product added successfully!');
        }
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
        document.getElementById('product-category').value = product.category_id || '';
        setProductUnitValue(product.unit_of_measure);
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
        if (!await window.utils.confirmDialog('This will permanently delete the product and its stock change history.', {
            title: 'Delete product?',
            confirmText: 'Delete product',
            variant: 'danger'
        })) {
            return;
        }

        // Delete dependent records first (FK constraints)
        const { error: movementsError } = await supabaseClient
            .from('stock_movements')
            .delete()
            .eq('product_id', productId);
        
        if (movementsError) throw movementsError;

        const { error: inventoryError } = await supabaseClient
            .from('inventory_stock')
            .delete()
            .eq('product_id', productId);
        
        if (inventoryError) throw inventoryError;

        // Now delete the product itself
        const { error: productError } = await supabaseClient
            .from('products')
            .delete()
            .eq('product_id', productId);
        
        if (productError) throw productError;

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
            
            const statusLabels = {
                out_of_stock: 'Out of Stock',
                low_stock: 'Low Stock',
                critical: 'Critical',
                in_stock: 'In Stock',
                overstocked: 'Overstocked'
            };
            const status = statusLabels[getProductStockStatus(product)];

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
        if (!await window.utils.confirmDialog(confirmMessage, {
            title: 'Restore inventory backup?',
            confirmText: 'Restore backup'
        })) {
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
                            product_name: String(product_name || '').trim().toUpperCase(),
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
                                product_name: String(product_name || '').trim().toUpperCase(),
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
                                product_name: String(product_name || '').trim().toUpperCase(),
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
                            product_name: String(product_name || '').trim().toUpperCase(),
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
    const validationError = validateProductImageFile(file);
    if (validationError) {
        showNotification(validationError, 'error');
        return;
    }
    
    selectedImageFile = file;
    displayImagePreview(file);
}

function validateProductImageFile(file) {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
        return 'Invalid file type. Please upload JPG, PNG, or WebP.';
    }

    if (file.size > 5 * 1024 * 1024) {
        return 'File too large. Maximum size is 5MB.';
    }

    return '';
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
async function saveProductImageFile(file, productId) {
    const timestamp = Date.now();
    const fileExtension = file.name.split('.').pop().toLowerCase();
    const fileName = `product-${productId}-${timestamp}.${fileExtension}`;
    const filePath = `product-images/${fileName}`;

    const { error: uploadError } = await supabaseClient.storage
        .from('product-images')
        .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false
        });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabaseClient.storage
        .from('product-images')
        .getPublicUrl(filePath);
    const imageUrl = publicUrlData.publicUrl;

    const { error: updateError } = await supabaseClient
        .from('products')
        .update({
            image_url: imageUrl,
            image_path: filePath,
            image_uploaded_at: new Date().toISOString()
        })
        .eq('product_id', productId);

    if (updateError) throw updateError;
    return imageUrl;
}

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
        
        const imageUrl = await saveProductImageFile(selectedImageFile, productId);
        
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
