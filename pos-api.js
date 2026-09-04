const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

async function requirePOSUser(req, res) {
  const authorization = req.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) {
    res.status(401).json({ error: 'Authorization token is required.' });
    return null;
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !authData.user) {
    res.status(401).json({ error: 'Your session is invalid or expired.' });
    return null;
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('users')
    .select('role, is_active')
    .eq('user_id', authData.user.id)
    .single();

  const role = String(profile?.role || '').toLowerCase();
  if (profileError || !profile?.is_active || !['owner', 'cashier', 'admin', 'manager'].includes(role)) {
    res.status(403).json({ error: 'You are not allowed to finalize POS sales.' });
    return null;
  }

  return { id: authData.user.id, role };
}

router.post('/pos/transactions/:transactionId/finalize', async (req, res, next) => {
  try {
    const user = await requirePOSUser(req, res);
    if (!user) return;

    const transactionId = req.params.transactionId;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(transactionId)) {
      return res.status(400).json({ error: 'Invalid transaction ID.' });
    }

    const { data: transaction, error: transactionError } = await supabaseAdmin
      .from('pos_transactions')
      .select('transaction_id, cashier_id, is_active, pos_transaction_items(product_id, quantity)')
      .eq('transaction_id', transactionId)
      .single();

    if (transactionError) throw transactionError;
    if (!transaction.is_active) return res.status(409).json({ error: 'This transaction is not active.' });
    if (user.role === 'cashier' && transaction.cashier_id !== user.id) {
      return res.status(403).json({ error: 'Cashiers may only finalize their own sales.' });
    }

    const items = transaction.pos_transaction_items || [];
    if (!items.length) return res.status(400).json({ error: 'The transaction has no line items.' });

    const updatedItems = [];
    for (const item of items) {
      const soldQuantity = Number(item.quantity);
      if (!item.product_id || !Number.isInteger(soldQuantity) || soldQuantity <= 0) {
        return res.status(400).json({ error: 'The transaction contains an invalid line item.' });
      }

      // A client may retry after losing the HTTP response. Do not deduct twice.
      const { data: existingMovement, error: movementReadError } = await supabaseAdmin
        .from('stock_movements')
        .select('quantity_after')
        .eq('reference_id', transactionId)
        .eq('product_id', item.product_id)
        .maybeSingle();
      if (movementReadError) throw movementReadError;
      if (existingMovement) {
        updatedItems.push({ productId: item.product_id, quantity: Number(existingMovement.quantity_after) });
        continue;
      }

      const { data: stock, error: stockError } = await supabaseAdmin
        .from('inventory_stock')
        .select('stock_id, quantity')
        .eq('product_id', item.product_id)
        .single();
      if (stockError) throw stockError;

      const quantityBefore = Number(stock.quantity);
      const quantityAfter = quantityBefore - soldQuantity;
      if (quantityAfter < 0) {
        return res.status(409).json({ error: `Insufficient stock for product ${item.product_id}.` });
      }

      const now = new Date().toISOString();
      const { data: updatedStock, error: updateError } = await supabaseAdmin
        .from('inventory_stock')
        .update({ quantity: quantityAfter, last_sale_date: now, updated_at: now })
        .eq('stock_id', stock.stock_id)
        .eq('quantity', quantityBefore)
        .select('quantity')
        .single();
      if (updateError || Number(updatedStock?.quantity) !== quantityAfter) {
        const error = updateError || new Error('Stock changed while the sale was being finalized.');
        error.status = 409;
        throw error;
      }

      const { error: movementError } = await supabaseAdmin.from('stock_movements').insert({
        product_id: item.product_id,
        movement_type: 'outbound',
        quantity_change: -soldQuantity,
        quantity_before: quantityBefore,
        quantity_after: quantityAfter,
        movement_date: now,
        reference_type: 'outbound_order',
        reference_id: transactionId,
        performed_by: user.id,
        notes: 'Point of sale transaction'
      });
      if (movementError) {
        // Restore this row if its matching audit movement could not be recorded.
        await supabaseAdmin
          .from('inventory_stock')
          .update({ quantity: quantityBefore, updated_at: new Date().toISOString() })
          .eq('stock_id', stock.stock_id)
          .eq('quantity', quantityAfter);
        throw movementError;
      }

      updatedItems.push({ productId: item.product_id, quantity: quantityAfter });
    }

    res.json({ success: true, inventory: updatedItems });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
