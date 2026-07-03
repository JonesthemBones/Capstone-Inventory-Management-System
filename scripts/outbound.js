// outbound.js - Simplified version with single quantity field

let selectedOutboundItems = [];

// Initialize outbound functionality
function initializeOutbound() {
    loadProductsForOutbound();
    setupOutboundEventListeners();
}

// Load products with available stock
async function loadProductsForOutbound() {
    try {
        const { data: products, error } = await supabaseClient
            .from('products')
            .select(`
                product_id,
                product_name,
                product_code,
                unit_of_measure,
                selling_price,
                unit_price,
                is_active,
                inventory_stock!inventory_stock_product_id_fkey(
                    stock_id,
                    quantity
                )
            `)
            .eq('is_active', true)
            .order('product_name');

        if (error) {
            console.error('Error loading products:', error);
            throw error;
        }

        console.log('Loaded products for outbound:', products);

        const productSelect = document.getElementById('product-select');
        if (!productSelect) return;

        productSelect.innerHTML = '<option value="">Select Product</option>';
        
        products?.forEach(product => {
            const inventory = product.inventory_stock?.[0] || product.inventory_stock || {};
            const quantity = inventory.quantity || 0;
            
            console.log(`Product: ${product.product_name}, Quantity: ${quantity}`);
            
            // Only show products with available stock
            if (quantity > 0) {
                const option = new Option(
                    `${product.product_name} (${product.product_code}) - Stock: ${quantity}`,
                    product.product_id
                );
                option.dataset.productData = JSON.stringify({
                    product_id: product.product_id,
                    product_name: product.product_name,
                    product_code: product.product_code,
                    unit_of_measure: product.unit_of_measure || 'pcs',
                    quantity: quantity,
                    selling_price: product.selling_price || 0,
                    unit_price: product.unit_price || 0
                });
                productSelect.add(option);
            }
        });

        console.log('Products loaded into dropdown');
    } catch (error) {
        console.error('Error loading products:', error);
        alert('Error loading products: ' + error.message);
    }
}

// Setup event listeners
function setupOutboundEventListeners() {
    // Open modal button
    const createOutboundBtn = document.getElementById('create-outbound-btn');
    if (createOutboundBtn) {
        createOutboundBtn.addEventListener('click', openOutboundModal);
    }

    // Close modal buttons
    const closeBtn = document.getElementById('close-outbound-modal');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeOutboundModal);
    }

    const cancelBtn = document.getElementById('cancel-outbound-btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', closeOutboundModal);
    }

    // Add item button
    const addItemBtn = document.getElementById('add-outbound-item-btn');
    if (addItemBtn) {
        addItemBtn.addEventListener('click', addOutboundItem);
    }

    // Form submit
    const outboundForm = document.getElementById('outbound-form');
    if (outboundForm) {
        outboundForm.addEventListener('submit', submitOutboundOrder);
    }
}

// Open outbound modal
function openOutboundModal() {
    console.log('Opening outbound modal');
    selectedOutboundItems = [];
    renderSelectedItems();
    
    // Auto-generate reference ID
    const referenceId = document.getElementById('reference-id');
    const timestamp = Date.now();
    const refId = `OUT-${new Date().getFullYear()}-${String(timestamp).slice(-6)}`;
    
    // Reset form
    const form = document.getElementById('outbound-form');
    if (form) {
        form.reset();
    }
    
    // Set the auto-generated reference ID after reset
    if (referenceId) {
        referenceId.value = refId;
    }

    // Reload products
    loadProductsForOutbound();

    const modal = document.getElementById('outbound-modal');
    if (modal) {
        modal.classList.add('active');
    }
}

// Close outbound modal
function closeOutboundModal() {
    const modal = document.getElementById('outbound-modal');
    if (modal) {
        modal.classList.remove('active');
    }
    selectedOutboundItems = [];
}

// Add item to outbound list
function addOutboundItem() {
    const productSelect = document.getElementById('product-select');
    const quantityInput = document.getElementById('outbound-quantity');

    const dispatchQty = parseInt(quantityInput.value);

    if (!productSelect.value) {
        alert('Please select a product');
        return;
    }

    if (!dispatchQty || dispatchQty <= 0) {
        alert('Please enter a valid quantity (greater than 0)');
        return;
    }

    const selectedOption = productSelect.options[productSelect.selectedIndex];
    const productData = JSON.parse(selectedOption.dataset.productData);

    console.log('Adding product:', productData);

    // Check if product already added
    const existingItem = selectedOutboundItems.find(item => item.product_id === productData.product_id);
    if (existingItem) {
        alert('This product is already in the list. Please remove it first to change quantity.');
        return;
    }

    // Check available stock
    if (dispatchQty > productData.quantity) {
        alert(`Not enough stock available.\nAvailable: ${productData.quantity}\nRequested: ${dispatchQty}`);
        return;
    }

    // Add item to list
    const item = {
        product_id: productData.product_id,
        product_name: productData.product_name,
        product_code: productData.product_code,
        unit_of_measure: productData.unit_of_measure,
        current_quantity: productData.quantity,
        dispatch_quantity: dispatchQty,
        unit_price: productData.selling_price,
        total_value: dispatchQty * productData.selling_price
    };

    selectedOutboundItems.push(item);
    console.log('Item added to list:', item);
    console.log('Current selected items:', selectedOutboundItems);

    renderSelectedItems();
    
    // Reset item input fields
    productSelect.value = '';
    quantityInput.value = '';
}

// Render selected items table
function renderSelectedItems() {
    const tbody = document.getElementById('selected-items-tbody');
    const container = document.getElementById('selected-items-container');
    
    if (!tbody || !container) return;
    
    if (selectedOutboundItems.length === 0) {
        container.style.display = 'none';
        return;
    }
    
    container.style.display = 'block';
    
    tbody.innerHTML = selectedOutboundItems.map((item, index) => {
        const remainingStock = item.current_quantity - item.dispatch_quantity;
        return `
            <tr>
                <td><strong>${item.product_code}</strong></td>
                <td>${item.product_name}</td>
                <td>${item.current_quantity} ${item.unit_of_measure}</td>
                <td><strong style="color: var(--danger);">${item.dispatch_quantity} ${item.unit_of_measure}</strong></td>
                <td><strong>${remainingStock} ${item.unit_of_measure}</strong></td>
                <td>${formatCurrency(item.unit_price)}</td>
                <td><strong>${formatCurrency(item.total_value)}</strong></td>
                <td>
                    <button type="button" class="icon-btn delete" onclick="removeOutboundItem(${index})" title="Remove">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
    
    // Update totals
    const totalValue = selectedOutboundItems.reduce((sum, item) => sum + item.total_value, 0);
    const totalItems = selectedOutboundItems.reduce((sum, item) => sum + item.dispatch_quantity, 0);
    
    const totalElement = document.getElementById('total-order-value');
    if (totalElement) {
        totalElement.textContent = formatCurrency(totalValue);
    }
    
    const totalItemsElement = document.getElementById('total-items-count');
    if (totalItemsElement) {
        totalItemsElement.textContent = totalItems;
    }
}

// Remove item from outbound list
function removeOutboundItem(index) {
    console.log('Removing item at index:', index);
    selectedOutboundItems.splice(index, 1);
    renderSelectedItems();
}

// Submit outbound order
async function submitOutboundOrder(e) {
    e.preventDefault();
    
    console.log('Submitting outbound order...');
    
    if (selectedOutboundItems.length === 0) {
        alert('Please add at least one product to dispatch');
        return;
    }

    const referenceType = document.getElementById('reference-type').value;
    const referenceId = document.getElementById('reference-id').value;
    const notes = document.getElementById('outbound-notes').value;

    if (!referenceType || !referenceId) {
        alert('Please fill in all required fields (Reference Type and Reference ID)');
        return;
    }

    console.log('Processing outbound:', {
        referenceType,
        referenceId,
        notes,
        items: selectedOutboundItems
    });

    try {
        // Get current user session
        const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
        
        if (sessionError) {
            console.error('Error getting session:', sessionError);
            throw new Error('Authentication error. Please log in again.');
        }
        
        if (!session) {
            throw new Error('You must be logged in to process outbound transactions.');
        }
        
        const performedBy = session.user.id;

        // Process each item
        for (const item of selectedOutboundItems) {
            console.log(`Processing product: ${item.product_name}, Dispatch Qty: ${item.dispatch_quantity}`);

            // 1. Get current stock from inventory_stock table
            const { data: currentStock, error: fetchError } = await supabaseClient
                .from('inventory_stock')
                .select('stock_id, quantity')
                .eq('product_id', item.product_id)
                .single();

            if (fetchError) {
                console.error('Error fetching current stock:', fetchError);
                throw new Error(`Failed to fetch stock for ${item.product_name}: ${fetchError.message}`);
            }

            console.log('Current stock before update:', currentStock);

            // 2. Calculate new quantity
            const newQuantity = currentStock.quantity - item.dispatch_quantity;
            
            // Validate stock
            if (newQuantity < 0) {
                throw new Error(`Insufficient stock for ${item.product_name}. Available: ${currentStock.quantity}, Requested: ${item.dispatch_quantity}`);
            }

            console.log(`Updating stock: ${currentStock.quantity} -> ${newQuantity}`);

            // 3. Update inventory_stock table
            const { data: updatedStock, error: updateError } = await supabaseClient
                .from('inventory_stock')
                .update({
                    quantity: newQuantity,
                    last_sale_date: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .eq('product_id', item.product_id)
                .select();

            if (updateError) {
                console.error('Error updating stock:', updateError);
                throw new Error(`Failed to update stock for ${item.product_name}: ${updateError.message}`);
            }

            console.log('Stock updated successfully:', updatedStock);

            // 4. Create stock movement record
            const movementNotes = notes 
                ? `${referenceType}: ${referenceId} | ${notes}`
                : `${referenceType}: ${referenceId}`;
            
            const movementData = {
                product_id: item.product_id,
                movement_type: 'outbound',
                reference_type: referenceType,
                reference_id: referenceId,
                quantity_change: -item.dispatch_quantity, // Negative for outbound
                quantity_after: newQuantity,  // Final quantity after transaction
                notes: movementNotes,
                movement_date: new Date().toISOString(),
                performed_by: performedBy
            };

            console.log('Creating stock movement:', movementData);

            const { data: movement, error: movementError } = await supabaseClient
                .from('stock_movements')
                .insert([movementData])
                .select();

            if (movementError) {
                console.error('Error creating movement record:', movementError);
                throw new Error(`Failed to create movement record for ${item.product_name}: ${movementError.message}`);
            }

            console.log('Movement record created:', movement);
        }

        // Success
        const totalItems = selectedOutboundItems.reduce((sum, item) => sum + item.dispatch_quantity, 0);
        const totalProducts = selectedOutboundItems.length;
        
        console.log('Outbound transaction completed successfully');
        
        alert(`✓ Outbound transaction completed successfully!\n\nReference: ${referenceId}\nType: ${referenceType}\nProducts: ${totalProducts}\nTotal items dispatched: ${totalItems}`);
        
        closeOutboundModal();
        
        // Reload inventory to show updated quantities
        if (typeof loadInventory === 'function' && typeof getFilters === 'function') {
            console.log('Reloading inventory...');
            await loadInventory(getFilters());
        }

    } catch (error) {
        console.error('Error processing outbound transaction:', error);
        alert('✖ Error processing outbound:\n\n' + error.message);
    }
}

// Initialize when document is ready
document.addEventListener('DOMContentLoaded', () => {
    // Small delay to ensure other scripts are loaded
    setTimeout(() => {
        console.log('Initializing outbound module...');
        initializeOutbound();
    }, 100);
});