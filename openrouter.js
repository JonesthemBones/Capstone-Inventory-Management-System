const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const router = express.Router();

// Debug middleware to log all routes
router.use((req, res, next) => {
    console.log(`OpenRouter middleware: ${req.method} ${req.path}`);
    next();
});

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_KEY || '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';
const OPENROUTER_MODEL = process.env.VISION_MODEL || 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free';
const PYTHON_BINARY = process.env.PYTHON_BINARY || 'python';
const PYTHON_SCRIPT = path.resolve(__dirname, './python_ocr.py');

// Supabase client initialization
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wxhkhxsxftundtrahpst.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind4aGtoeHN4ZnR1bmR0cmFocHN0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDU3ODc3NywiZXhwIjoyMDc2MTU0Nzc3fQ.R_J7gu9Z7T0CEp0t0Ky8XC0kHvHxDtpqX2t5Vz_K6lE';
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function extractJsonObject(text) {
    if (!text) return null;
    const normalized = String(text).trim();

    try {
        return JSON.parse(normalized);
    } catch (outerError) {
        const match = normalized.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        if (!match) return null;
        try {
            return JSON.parse(match[0]);
        } catch (innerError) {
            return null;
        }
    }
}

function parseDataUrl(dataUrl) {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(String(dataUrl));
    if (!match) return null;
    return {
        mediaType: match[1],
        base64Data: match[2]
    };
}

function imageExtension(mediaType) {
    switch (mediaType) {
        case 'image/png':
            return 'png';
        case 'image/gif':
            return 'gif';
        case 'image/webp':
            return 'webp';
        default:
            return 'jpg';
    }
}

router.post('/ocr-scan', async (req, res) => {
    let tempDir;
    let tempFile;

    try {
        const imageDataUrl = req.body?.imageDataUrl;
        if (!imageDataUrl) {
            return res.status(400).json({ error: 'Missing imageDataUrl in request body.' });
        }
        if (!imageDataUrl.startsWith('data:image/')) {
            return res.status(400).json({ error: 'Invalid imageDataUrl. Must be a data URL for an image.' });
        }

        const parsedImage = parseDataUrl(imageDataUrl);
        if (!parsedImage) {
            return res.status(400).json({ error: 'Unable to parse the receipt image data URL.' });
        }

        if (!OPENROUTER_API_KEY) {
            return res.status(500).json({ error: 'OpenRouter API key is not configured on the server.' });
        }

        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-'));
        tempFile = path.join(tempDir, `receipt.${imageExtension(parsedImage.mediaType)}`);
        fs.writeFileSync(tempFile, Buffer.from(parsedImage.base64Data, 'base64'));

        const pythonEnv = {
            ...process.env,
            OPENROUTER_API_KEY,
            VISION_MODEL: OPENROUTER_MODEL
        };

        const child = spawn(PYTHON_BINARY, [PYTHON_SCRIPT, tempFile], {
            env: pythonEnv,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        const exitCode = await new Promise((resolve) => child.on('close', resolve));

        if (tempDir) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }

        console.log(`OCR subprocess exited with code ${exitCode}`);
        if (stderr) console.error('Python stderr:', stderr);
        if (stdout) console.log('Python stdout:', stdout);

        if (exitCode !== 0) {
            console.error('OCR subprocess stderr:', stderr);
            console.error('OCR subprocess stdout:', stdout);
            return res.status(502).json({
                error: 'OCR subprocess failed.',
                details: stderr.trim() || 'No stderr output from Python OCR subprocess.',
                rawOutput: stdout.trim()
            });
        }

        const parsed = extractJsonObject(stdout.trim());
        if (!parsed) {
            console.warn('Unable to parse JSON from Python OCR output');
            return res.status(502).json({
                error: 'Unable to parse JSON from OCR output.',
                rawContent: stdout.trim(),
                stderr: stderr.trim()
            });
        }

        return res.json({
            success: true,
            receipt: parsed,
            rawResponse: {
                stdout: parsed,
                stderr: stderr.trim()
            }
        });
    } catch (error) {
        console.error('OCR scan error:', error);
        if (tempDir) {
            try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (cleanupError) { /* ignore */ }
        }
        return res.status(500).json({
            error: 'OCR scan failed on the server.',
            message: error?.message || 'Unknown error.'
        });
    }
});

router.post('/save-items-to-inventory', async (req, res) => {
    try {
        const { items } = req.body;
        
        console.log('Save items request received:', items ? items.length : 'no items');
        
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Invalid items array. Must be non-empty.' });
        }

        // Filter to only accepted items
        const acceptedItems = items.filter(item => item.accepted && !item.removed);
        
        if (acceptedItems.length === 0) {
            return res.status(400).json({ error: 'No accepted items to save. Please accept at least one item.' });
        }

        const normalizeName = (text) => String(text || '')
            .trim()
            .replace(/\s+/g, ' ')
            .toLowerCase();

        const deduped = acceptedItems.reduce((map, item) => {
            const productName = (item.name || '').trim();
            const normalizedName = normalizeName(productName);
            if (!normalizedName) return map;

            const quantity = parseInt(item.real_quantity) || parseInt(item.receipt_quantity) || 1;
            const price = parseFloat(item.price) || 0;
            const comment = (item.comment || '').trim();

            if (!map.has(normalizedName)) {
                map.set(normalizedName, {
                    originalName: productName,
                    normalizedName,
                    quantity,
                    price,
                    comments: comment ? [comment] : [],
                    rawItems: [item]
                });
            } else {
                const entry = map.get(normalizedName);
                entry.quantity += quantity;
                if (!entry.price && price) entry.price = price;
                if (comment) entry.comments.push(comment);
                entry.rawItems.push(item);
            }
            return map;
        }, new Map());

        const dedupedItems = Array.from(deduped.values()).map(entry => ({
            ...entry,
            quantity: entry.quantity,
            comment: entry.comments.filter(Boolean).join(' | ')
        }));

        const results = {
            successful: [],
            failed: []
        };

        for (const item of dedupedItems) {
            try {
                const productName = (item.originalName || item.name || '').trim();
                const price = parseFloat(item.price) || 0;
                const quantity = parseInt(item.quantity) || 1;
                const comment = (item.comment || '').trim();

                if (!productName || productName.length < 2) {
                    results.failed.push({
                        name: item.name,
                        error: 'Product name is too short or empty'
                    });
                    continue;
                }

                // Normalize product name for comparison (lowercase, trim extra spaces)
                const normalizedName = productName.toLowerCase().replace(/\s+/g, ' ');

                // Check if product already exists (case-insensitive)
                const { data: allProducts } = await supabaseClient
                    .from('products')
                    .select('product_id, product_name');

                const existingProduct = allProducts?.find(p => 
                    p.product_name.toLowerCase().replace(/\s+/g, ' ') === normalizedName
                ) || null;

                let productId;
                let isNew = false;
                let previousQuantity = 0;

                if (existingProduct) {
                    // Product exists - update existing stock
                    productId = existingProduct.product_id;

                    // Get current inventory
                    const { data: currentStockArray } = await supabaseClient
                        .from('inventory_stock')
                        .select('stock_id, quantity')
                        .eq('product_id', productId)
                        .limit(1);

                    const currentStock = currentStockArray && currentStockArray.length > 0 ? currentStockArray[0] : null;
                    previousQuantity = currentStock?.quantity || 0;
                    const newQuantity = previousQuantity + quantity;

                    if (currentStock) {
                        const { error: updateError } = await supabaseClient
                            .from('inventory_stock')
                            .update({ 
                                quantity: newQuantity,
                                last_restock_date: new Date().toISOString()
                            })
                            .eq('stock_id', currentStock.stock_id);

                        if (updateError) throw updateError;
                    } else {
                        const { error: insertStockError } = await supabaseClient
                            .from('inventory_stock')
                            .insert([{
                                product_id: productId,
                                quantity: newQuantity,
                                last_restock_date: new Date().toISOString()
                            }]);

                        if (insertStockError) throw insertStockError;
                    }

                    // Record stock movement
                    const { error: movementError } = await supabaseClient
                        .from('stock_movements')
                        .insert([{
                            product_id: productId,
                            movement_type: 'inbound',
                            quantity_change: quantity,
                            quantity_before: previousQuantity,
                            quantity_after: newQuantity,
                            reference_type: 'receipt_scan',
                            notes: `Receipt scan update. Receipt qty: ${quantity}` + (comment ? `. ${comment}` : '')
                        }]);

                    if (movementError) throw movementError;

                    results.successful.push({
                        name: productName,
                        quantity: quantity,
                        previousQuantity: previousQuantity,
                        newQuantity: newQuantity,
                        productId: productId,
                        isNew: false,
                        message: `Updated stock (+${quantity} units)`
                    });
                } else {
                    // Product doesn't exist - create new
                    const { data: newProduct, error: insertError } = await supabaseClient
                        .from('products')
                        .insert([{
                            product_name: productName,
                            unit_price: price,
                            selling_price: price,
                            unit_of_measure: 'unit',
                            description: comment || `Imported from receipt scan. Qty: ${item.receipt_quantity}`,
                            reorder_level: Math.max(5, quantity / 2),
                            maximum_stock: null
                        }])
                        .select()
                        .single();

                    if (insertError) throw insertError;

                    productId = newProduct.product_id;
                    isNew = true;

                    // Insert inventory stock record
                    const { error: stockError } = await supabaseClient
                        .from('inventory_stock')
                        .insert([{
                            product_id: productId,
                            quantity: quantity,
                            last_restock_date: new Date().toISOString()
                        }]);

                    if (stockError) throw stockError;

                    // Insert stock movement record
                    const { error: movementError } = await supabaseClient
                        .from('stock_movements')
                        .insert([{
                            product_id: productId,
                            movement_type: 'inbound',
                            quantity_change: quantity,
                            quantity_before: 0,
                            quantity_after: quantity,
                            reference_type: 'receipt_scan',
                            notes: `Receipt scan import. Receipt qty: ${item.receipt_quantity}` + (comment ? `. ${comment}` : '')
                        }]);

                    if (movementError) throw movementError;

                    results.successful.push({
                        name: productName,
                        price: price,
                        quantity: quantity,
                        productId: productId,
                        isNew: true,
                        message: `Created new product`
                    });
                }
            } catch (itemError) {
                console.error('Error processing item:', itemError);
                results.failed.push({
                    name: item.name,
                    error: itemError.message || 'Unknown error while saving item'
                });
            }
        }

        res.json({
            success: true,
            message: `Processed ${results.successful.length} item(s)`,
            results: results
        });
    } catch (error) {
        console.error('Error saving items to inventory:', error);
        res.status(500).json({
            error: 'Failed to save items to inventory',
            message: error?.message || 'Unknown error'
        });
    }
});

module.exports = router;
