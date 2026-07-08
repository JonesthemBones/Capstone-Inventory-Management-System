// outbound.js - Updated with thumbnail support and product grid

let selectedOutboundProduct = null;
let selectedOutboundItems = [];

// Initialize outbound functionality
function initializeOutbound() {
    setupOutboundEventListeners();
}

// Load products with available stock (for thumbnail grid)
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
                image_url,
                image_path,
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

        const productGrid = document.getElementById('outbound-product-grid');
        if (!productGrid) return;

        productGrid.innerHTML = '';
        
        products?.forEach(product => {
            const inventory = product.inventory_stock?.[0] || product.inventory_stock || {};
            const quantity = inventory.quantity || 0;
            
            // Only show products with available stock
            if (quantity > 0) {
                const productCard = createProductCard(product, quantity);
                productGrid.appendChild(productCard);
            }
        });

        console.log('Products loaded into grid');
    } catch (error) {
        console.error('Error loading products:', error);
        alert('Error loading products: ' + error.message);
    }
}

// Resolve product image URL from Supabase storage or fallback
function getProductImageUrl(imagePath) {
    if (!imagePath) return null;
    if (imagePath.startsWith('http')) return imagePath;

    const storageBaseUrl = 'https://wxhkhxsxftundtrahpst.supabase.co/storage/v1/object/public/product-images';
    const relativePath = imagePath.replace(/^product-images\//, '');
    return `${storageBaseUrl}/${relativePath}`;
}

// Create product card with thumbnail
function createProductCard(product, quantity) {
    const card = document.createElement('div');
    card.className = 'product-card';
    
    const imageUrl = product.image_url || getProductImageUrl(product.image_path);
    const imageHtml = imageUrl
        ? `<img src="${imageUrl}" alt="${product.product_name}" onerror="this.onerror=null; this.src='https://via.placeholder.com/120?text=No+Image';">`
        : `<div class="product-card-image-placeholder"><i class="fas fa-image"></i></div>`;

    card.innerHTML = `
        <div class="product-card-image ${imageUrl ? '' : 'placeholder'}">
            ${imageHtml}
            <div class="stock-badge ${quantity <= 5 ? 'low-stock' : ''}">${quantity} ${product.unit_of_measure}</div>
        </div>
        <div class="product-card-info">
            <h4 class="product-card-name" title="${product.product_name}">${product.product_name}</h4>
            <p class="product-card-code">${product.product_code || 'N/A'}</p>
            <p class="product-card-price">${formatCurrency(product.selling_price)}</p>
        </div>
    `;
    
    card.addEventListener('click', () => selectOutboundProduct(product, quantity));
    
    return card;
}

// Select product from grid
function selectOutboundProduct(product, quantity) {
    selectedOutboundProduct = {
        product_id: product.product_id,
        product_name: product.product_name,
        product_code: product.product_code,
        unit_of_measure: product.unit_of_measure || 'pcs',
        quantity: quantity,
        selling_price: product.selling_price || 0,
        unit_price: product.unit_price || 0,
        image_url: product.image_url,
        image_path: product.image_path
    };

    // Update UI to show selected product
    updateOutboundProductDisplay();
    
    console.log('Product selected:', selectedOutboundProduct);
}

// Update product display in form
function updateOutboundProductDisplay() {
    if (!selectedOutboundProduct) return;

    const productDisplay = document.getElementById('outbound-product-display');
    const availableQty = document.getElementById('available-quantity');
    const unitPrice = document.getElementById('unit-price');
    const outboundQty = document.getElementById('outbound-quantity');

    if (productDisplay) {
        const imageUrl = selectedOutboundProduct.image_url || getProductImageUrl(selectedOutboundProduct.image_path);
        const imageHtml = imageUrl
            ? `<img src="${imageUrl}" alt="${selectedOutboundProduct.product_name}" style="width: 80px; height: 80px; object-fit: cover; border-radius: 6px;" onerror="this.onerror=null; this.src='https://via.placeholder.com/80?text=No+Image';">`
            : `<div style="width: 80px; height: 80px; border: 2px dashed var(--border-color); border-radius: 6px; display: flex; align-items: center; justify-content: center; background: var(--bg-secondary); color: var(--text-secondary);"><i class="fas fa-image"></i></div>`;

        productDisplay.innerHTML = `
            <div style="display: flex; gap: 16px; align-items: center; padding: 16px; background-color: var(--bg-light); border-radius: 8px;">
                ${imageHtml}
                <div style="flex: 1;">
                    <h4 style="margin: 0 0 4px 0; font-size: 16px; font-weight: 600;">${selectedOutboundProduct.product_name}</h4>
                    <p style="margin: 0 0 4px 0; font-size: 13px; color: var(--text-secondary);">${selectedOutboundProduct.product_code}</p>
                    <p style="margin: 0; font-size: 13px; color: var(--text-secondary);">Unit: ${selectedOutboundProduct.unit_of_measure}</p>
                </div>
                <button type="button" class="btn" onclick="clearSelectedProduct()" style="white-space: nowrap;">
                    <i class="fas fa-times"></i> Change
                </button>
            </div>
        `;
    }

    if (availableQty) availableQty.value = selectedOutboundProduct.quantity;
    if (unitPrice) unitPrice.value = formatCurrency(selectedOutboundProduct.selling_price);
    
    // Clear quantity input
    if (outboundQty) {
        outboundQty.value = '';
        outboundQty.focus();
    }
}

// Clear selected product
function clearSelectedProduct() {
    selectedOutboundProduct = null;
    const productDisplay = document.getElementById('outbound-product-display');
    if (productDisplay) {
        productDisplay.innerHTML = `
            <div style="padding: 24px; text-align: center; background-color: var(--bg-light); border-radius: 8px; border: 2px dashed var(--border-color);">
                <i class="fas fa-inbox" style="font-size: 32px; color: var(--text-secondary); margin-bottom: 8px;"></i>
                <p style="margin: 0; color: var(--text-secondary);">Select a product from the grid above</p>
            </div>
        `;
    }
    const availableQty = document.getElementById('available-quantity');
    const unitPrice = document.getElementById('unit-price');
    if (availableQty) availableQty.value = '';
    if (unitPrice) unitPrice.value = '';
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

    // Quantity input change
    const quantityInput = document.getElementById('outbound-quantity');
    if (quantityInput) {
        quantityInput.addEventListener('change', calculateOutboundTotal);
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
    selectedOutboundProduct = null;
    clearSelectedProduct();
    
    // Reset form
    const form = document.getElementById('outbound-form');
    if (form) {
        form.reset();
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
    selectedOutboundProduct = null;
}

// Calculate outbound total
function calculateOutboundTotal() {
    if (!selectedOutboundProduct) {
        alert('Please select a product first');
        return;
    }

    const quantityInput = document.getElementById('outbound-quantity');
    const totalInput = document.getElementById('outbound-total');
    
    const quantity = parseInt(quantityInput.value) || 0;
    
    if (quantity <= 0) {
        if (totalInput) totalInput.value = formatCurrency(0);
        return;
    }

    if (quantity > selectedOutboundProduct.quantity) {
        alert(`Not enough stock available.\nAvailable: ${selectedOutboundProduct.quantity}\nRequested: ${quantity}`);
        quantityInput.value = '';
        if (totalInput) totalInput.value = formatCurrency(0);
        return;
    }

    const total = quantity * selectedOutboundProduct.selling_price;
    if (totalInput) totalInput.value = formatCurrency(total);
}

// Submit outbound order
async function submitOutboundOrder(e) {
    e.preventDefault();
    
    console.log('Submitting outbound order...');
    
    if (!selectedOutboundProduct) {
        alert('Please select a product');
        return;
    }

    const quantityInput = document.getElementById('outbound-quantity');
    const outboundType = document.getElementById('outbound-type').value;
    const outboundReference = document.getElementById('outbound-reference').value;
    const outboundNotes = document.getElementById('outbound-notes').value;

    const dispatchQty = parseInt(quantityInput.value);

    if (!dispatchQty || dispatchQty <= 0) {
        alert('Please enter a valid quantity (greater than 0)');
        return;
    }

    if (!outboundType || !outboundReference) {
        alert('Please fill in all required fields');
        return;
    }

    console.log('Processing outbound:', {
        outboundType,
        outboundReference,
        product: selectedOutboundProduct,
        quantity: dispatchQty,
        notes: outboundNotes
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

        // Get current stock from inventory_stock table
        const { data: currentStock, error: fetchError } = await supabaseClient
            .from('inventory_stock')
            .select('stock_id, quantity')
            .eq('product_id', selectedOutboundProduct.product_id)
            .single();

        if (fetchError) {
            console.error('Error fetching current stock:', fetchError);
            throw new Error(`Failed to fetch stock: ${fetchError.message}`);
        }

        console.log('Current stock before update:', currentStock);

        // Calculate new quantity
        const newQuantity = currentStock.quantity - dispatchQty;
        
        // Validate stock
        if (newQuantity < 0) {
            throw new Error(`Insufficient stock. Available: ${currentStock.quantity}, Requested: ${dispatchQty}`);
        }

        console.log(`Updating stock: ${currentStock.quantity} -> ${newQuantity}`);

        // Update inventory_stock table
        const { data: updatedStock, error: updateError } = await supabaseClient
            .from('inventory_stock')
            .update({
                quantity: newQuantity,
                last_sale_date: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('product_id', selectedOutboundProduct.product_id)
            .select();

        if (updateError) {
            console.error('Error updating stock:', updateError);
            throw new Error(`Failed to update stock: ${updateError.message}`);
        }

        console.log('Stock updated successfully:', updatedStock);

        // Create stock movement record
        const movementNotes = outboundNotes 
            ? `${outboundType}: ${outboundReference} | ${outboundNotes}`
            : `${outboundType}: ${outboundReference}`;
        
        const movementData = {
            product_id: selectedOutboundProduct.product_id,
            movement_type: 'outbound',
            reference_type: 'outbound_order',
            reference_id: outboundReference,
            quantity_change: -dispatchQty,
            quantity_after: newQuantity,
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
            throw new Error(`Failed to create movement record: ${movementError.message}`);
        }

        console.log('Movement record created:', movement);

        // Success
        console.log('Outbound transaction completed successfully');
        
        alert(`✓ Outbound transaction completed successfully!\n\nProduct: ${selectedOutboundProduct.product_name}\nReference: ${outboundReference}\nType: ${outboundType}\nQuantity Dispatched: ${dispatchQty}`);
        
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
    setTimeout(() => {
        console.log('Initializing outbound module...');
        initializeOutbound();
    }, 100);
});