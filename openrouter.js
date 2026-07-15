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

const OCR_CONFIG_FILE = path.resolve(__dirname, './ocr_settings.json');
const PYTHON_BINARY = process.env.PYTHON_BINARY || 'python';
const PYTHON_SCRIPT = path.resolve(__dirname, './python_ocr.py');

// Supabase client initialization
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wxhkhxsxftundtrahpst.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind4aGtoeHN4ZnR1bmR0cmFocHN0Iiwicm9zZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MDU3ODc3NywiZXhwIjoyMDc2MTU0Nzc3fQ.R_J7gu9Z7T0CEp0t0Ky8XC0kHvHxDtpqX2t5Vz_K6lE';
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function loadOCRConfig() {
    const defaults = {
        apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_KEY || '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',
        model: process.env.VISION_MODEL || 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free'
    };

    try {
        if (fs.existsSync(OCR_CONFIG_FILE)) {
            const raw = fs.readFileSync(OCR_CONFIG_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed?.apiKey) {
                defaults.apiKey = parsed.apiKey;
            }
            if (parsed?.model) {
                defaults.model = parsed.model;
            }
        }
    } catch (error) {
        console.error('Unable to load OCR settings file:', error);
    }

    return defaults;
}

function persistOCRConfig({ apiKey, model }) {
    const payload = {
        apiKey: String(apiKey || '').trim(),
        model: String(model || '').trim()
    };

    if (!payload.apiKey || !payload.model) {
        throw new Error('Both apiKey and model are required to persist OCR settings.');
    }

    fs.writeFileSync(OCR_CONFIG_FILE, JSON.stringify(payload, null, 2), 'utf8');
    return payload;
}

function generateProductCode(productName) {
    const normalized = String(productName || 'PRD')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
    const prefix = normalized.substring(0, 3).padEnd(3, 'X');
    const timestamp = Date.now().toString().slice(-5);
    const randomSuffix = Math.random().toString(36).slice(2, 7).toUpperCase();
    return `${prefix}-${timestamp}-${randomSuffix}`;
}

function normalizeProductName(productName) {
    return String(productName || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ');
}

async function findUniqueProductCode(productName, maxAttempts = 5) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const candidate = generateProductCode(productName);
        const { data: existing, error } = await supabaseClient
            .from('products')
            .select('product_id')
            .eq('product_code', candidate)
            .limit(1)
            .maybeSingle();

        if (error) {
            throw error;
        }

        if (!existing) {
            return candidate;
        }
    }

    throw new Error('Unable to generate a unique product code after multiple attempts.');
}

async function ensureProductCodeForProduct(productId, productName, currentCode) {
    if (currentCode && String(currentCode).trim()) {
        return currentCode;
    }

    const productCode = await findUniqueProductCode(productName);
    const { error: updateError } = await supabaseClient
        .from('products')
        .update({ product_code: productCode })
        .eq('product_id', productId);

    if (updateError) {
        throw updateError;
    }

    return productCode;
}

async function requireAdmin(req, res) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    if (!token) {
        res.status(401).json({ error: 'Authorization token is required.' });
        return null;
    }

    const { data, error } = await supabaseClient.auth.getUser(token);
    if (error || !data?.user) {
        res.status(401).json({ error: 'Invalid or expired authorization token.' });
        return null;
    }

    const userId = data.user.id;
    const { data: userProfile, error: profileError } = await supabaseClient
        .from('users')
        .select('role')
        .eq('user_id', userId)
        .single();

    if (profileError || !userProfile) {
        res.status(403).json({ error: 'Unable to verify user role.' });
        return null;
    }

    if ((userProfile.role || '').toLowerCase() !== 'admin') {
        res.status(403).json({ error: 'Admin access required.' });
        return null;
    }

    return { user: data.user, role: userProfile.role.toLowerCase() };
}

async function logReceiptAuditEvent({ userId, actionType, tableAffected = 'receipt_scan', recordId = null, oldValues = {}, newValues = {} }) {
    try {
        const payload = {
            user_id: userId || null,
            action_type: actionType,
            table_affected: tableAffected,
            record_id: recordId || null,
            old_values: oldValues || {},
            new_values: newValues || {},
            user_agent: 'server-receipt-scan',
            action_timestamp: new Date().toISOString()
        };

        const { error } = await supabaseClient.from('audit_logs').insert([payload]);
        if (error) {
            console.error('Receipt scan audit log write failed:', error);
        }
    } catch (error) {
        console.error('Unexpected receipt scan audit log error:', error);
    }
}

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

        const ocrConfig = loadOCRConfig();
        if (!ocrConfig.apiKey) {
            return res.status(500).json({ error: 'OpenRouter API key is not configured on the server.' });
        }

        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-'));
        tempFile = path.join(tempDir, `receipt.${imageExtension(parsedImage.mediaType)}`);
        fs.writeFileSync(tempFile, Buffer.from(parsedImage.base64Data, 'base64'));

        const pythonEnv = {
            ...process.env,
            OPENROUTER_API_KEY: ocrConfig.apiKey,
            VISION_MODEL: ocrConfig.model
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

router.get('/ocr-config', async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const config = loadOCRConfig();
    res.json({
        success: true,
        config
    });
});

router.post('/ocr-config', async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { apiKey, model } = req.body;
    if (!apiKey || !model) {
        return res.status(400).json({ error: 'Both apiKey and model are required.' });
    }

    try {
        const saved = persistOCRConfig({ apiKey, model });
        return res.json({
            success: true,
            config: saved
        });
    } catch (err) {
        console.error('Unable to save OCR config:', err);
        return res.status(500).json({ error: 'Unable to save OCR settings.' });
    }
});

router.post('/save-items-to-inventory', async (req, res) => {
    try {
        const { items, userId } = req.body;
        
        console.log('Save items request received:', items ? items.length : 'no items');
        
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Invalid items array. Must be non-empty.' });
        }

        const receiptItems = items.filter(item => item && typeof item === 'object');
        const acceptedItems = receiptItems.filter(item => item.accepted && !item.removed);
        const rejectedItems = receiptItems.filter(item => item.removed);
        const pendingItems = receiptItems.filter(item => !item.accepted && !item.removed);
        
        if (acceptedItems.length === 0) {
            await logReceiptAuditEvent({
                userId,
                actionType: 'receipt_scan_decision',
                tableAffected: 'receipt_scan',
                newValues: {
                    summary: {
                        totalItems: receiptItems.length,
                        acceptedItems: acceptedItems.length,
                        rejectedItems: rejectedItems.length,
                        pendingItems: pendingItems.length
                    },
                    items: receiptItems.map(item => ({
                        name: item.name || '',
                        comment: item.comment || '',
                        decision: item.removed ? 'rejected' : 'pending',
                        real_quantity: item.real_quantity ?? item.receipt_quantity ?? 1
                    }))
                }
            });

            return res.json({
                success: true,
                message: 'Receipt review decisions recorded. No items were imported into inventory.',
                results: {
                    successful: [],
                    failed: [],
                    rejected: receiptItems.filter(item => item.removed).map(item => ({
                        name: item.name || 'Unnamed item',
                        comment: item.comment || '',
                        decision: 'rejected'
                    }))
                }
            });
        }

        await logReceiptAuditEvent({
            userId,
            actionType: 'receipt_scan_decision',
            tableAffected: 'receipt_scan',
            newValues: {
                summary: {
                    totalItems: receiptItems.length,
                    acceptedItems: acceptedItems.length,
                    rejectedItems: rejectedItems.length,
                    pendingItems: pendingItems.length
                },
                items: receiptItems.map(item => ({
                    name: item.name || '',
                    comment: item.comment || '',
                    decision: item.removed ? 'rejected' : item.accepted ? 'accepted' : 'pending',
                    real_quantity: item.real_quantity ?? item.receipt_quantity ?? 1
                }))
            }
        });

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
            const unitPrice = Number.isFinite(Number(item.unit_price)) ? Number(item.unit_price) : price;
            const sellingPrice = Number.isFinite(Number(item.selling_price)) ? Number(item.selling_price) : unitPrice;
            const unitOfMeasure = String(item.unit_of_measure || item.unit || 'unit').trim() || 'unit';
            const comment = (item.comment || '').trim();

            if (!map.has(normalizedName)) {
                map.set(normalizedName, {
                    originalName: productName,
                    normalizedName,
                    quantity,
                    price,
                    unit_price: unitPrice,
                    selling_price: sellingPrice,
                    unit_of_measure: unitOfMeasure,
                    comments: comment ? [comment] : [],
                    rawItems: [item]
                });
            } else {
                const entry = map.get(normalizedName);
                entry.quantity += quantity;
                if (!entry.price && price) entry.price = price;
                if (!entry.unit_price && unitPrice) entry.unit_price = unitPrice;
                if (!entry.selling_price && sellingPrice) entry.selling_price = sellingPrice;
                if (!entry.unit_of_measure && unitOfMeasure) entry.unit_of_measure = unitOfMeasure;
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
            failed: [],
            rejected: []
        };

        for (const item of rejectedItems) {
            const comment = (item.comment || '').trim();
            results.rejected.push({
                name: item.name || 'Unnamed item',
                comment,
                decision: 'rejected'
            });

            await logReceiptAuditEvent({
                userId,
                actionType: 'receipt_scan_item_rejected',
                tableAffected: 'receipt_scan',
                newValues: {
                    itemName: item.name || 'Unnamed item',
                    comment,
                    decision: 'rejected',
                    real_quantity: item.real_quantity ?? item.receipt_quantity ?? 1
                }
            });
        }

        for (const item of dedupedItems) {
            try {
                const productName = (item.originalName || item.name || '').trim();
                const price = parseFloat(item.price) || 0;
                const unitPrice = Number.isFinite(Number(item.unit_price)) ? Number(item.unit_price) : price;
                const sellingPrice = Number.isFinite(Number(item.selling_price)) ? Number(item.selling_price) : unitPrice;
                const quantity = parseInt(item.quantity) || 1;
                const comment = (item.comment || '').trim();

                if (!productName || productName.length < 2) {
                    results.failed.push({
                        name: item.name,
                        error: 'Product name is too short or empty'
                    });
                    continue;
                }

                // Normalize product name for comparison and merge names with punctuation differences
                const normalizedName = normalizeProductName(productName);

                // Check if product already exists (case-insensitive, punctuation-insensitive)
                const { data: allProducts } = await supabaseClient
                    .from('products')
                    .select('product_id, product_name, product_code');

                const existingProduct = allProducts?.find(p => 
                    normalizeProductName(p.product_name) === normalizedName
                ) || null;

                let productId;
                let isNew = false;
                let previousQuantity = 0;

                if (existingProduct) {
                    if (!existingProduct.product_code) {
                        try {
                            existingProduct.product_code = await ensureProductCodeForProduct(
                                existingProduct.product_id,
                                productName,
                                existingProduct.product_code
                            );
                        } catch (codeError) {
                            console.warn('Failed to assign missing product code for existing product:', codeError);
                        }
                    }
                    // Product exists - update existing stock and pricing
                    productId = existingProduct.product_id;

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

                    const { error: updateProductError } = await supabaseClient
                        .from('products')
                        .update({
                            unit_price: unitPrice,
                            selling_price: sellingPrice,
                            unit_of_measure: item.unit_of_measure || 'unit'
                        })
                        .eq('product_id', productId);

                    if (updateProductError) throw updateProductError;

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

                    await logReceiptAuditEvent({
                        userId,
                        actionType: 'receipt_scan_item_accepted',
                        tableAffected: 'products',
                        recordId: productId,
                        newValues: {
                            itemName: productName,
                            quantity,
                            comment,
                            decision: 'accepted',
                            previousQuantity,
                            newQuantity,
                            source: 'receipt_scan'
                        }
                    });
                } else {
                    // Product doesn't exist - create new and generate a unique product code
                    const productCode = await findUniqueProductCode(productName);
                    const reorderLevel = Math.max(5, Math.ceil(Number(quantity) / 2));
                    const { data: newProduct, error: insertError } = await supabaseClient
                        .from('products')
                        .insert([{
                            product_name: productName,
                            product_code: productCode,
                            unit_price: Number.isFinite(Number(item.unit_price)) ? Number(item.unit_price) : price,
                            selling_price: Number.isFinite(Number(item.selling_price)) ? Number(item.selling_price) : price,
                            unit_of_measure: item.unit_of_measure || 'unit',
                            description: comment || `Imported from receipt scan. Qty: ${item.receipt_quantity}`,
                            reorder_level: Number.isFinite(reorderLevel) ? reorderLevel : 5,
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

                    await logReceiptAuditEvent({
                        userId,
                        actionType: 'receipt_scan_item_accepted',
                        tableAffected: 'products',
                        recordId: productId,
                        newValues: {
                            itemName: productName,
                            quantity,
                            comment,
                            decision: 'accepted',
                            previousQuantity: 0,
                            newQuantity: quantity,
                            source: 'receipt_scan'
                        }
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
