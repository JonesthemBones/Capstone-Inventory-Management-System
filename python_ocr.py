#!/usr/bin/env python3
import base64
import json
import os
import re
import sys
import urllib.error
import urllib.request
import ssl


def parse_receipt_response(text):
    """
    Parse LLM response to extract receipt items.
    Expects format like: "Item Name - Qty: 2 - ₱100.00"
    """
    if not text or not isinstance(text, str):
        return {'items': []}
    
    lines = text.strip().split('\n')
    items = []
    
    for line in lines:
        line = line.strip()
        if not line or len(line) < 3:
            continue
        
        # Skip obvious non-item lines
        if any(skip in line.lower() for skip in [
            'total', 'subtotal', 'tax', 'discount', 'amount due', 'thank', 
            'items:', 'item name', 'table header', 'row', 'delivery'
        ]):
            continue
        
        # Look for Qty pattern (handles "Qty: 2" or "qty 2")
        qty_match = re.search(r'qty[:\s]+(\d+)', line, re.IGNORECASE)
        if not qty_match:
            # No quantity found, skip this line (we require quantity)
            continue
        
        receipt_quantity = int(qty_match.group(1))
        
        # Look for price AFTER the qty pattern
        # Get everything after the qty match
        after_qty = line[qty_match.end():]
        price_match = re.search(r'[₱$]?\s*(\d+(?:[,\.]?\d+)*(?:\.\d{2})?)', after_qty)
        if not price_match:
            continue
        
        # Clean price string: remove commas, keep decimal point
        price_str = price_match.group(1).replace(',', '')
        try:
            price = float(price_str)
        except ValueError:
            continue
        
        # Extract item name: everything before the first hyphen or Qty
        name = re.split(r'\s*[-–—]\s*|qty[:\s]+', line, flags=re.IGNORECASE)[0].strip()
        
        # Clean name
        name = re.sub(r'[^\w\s\(\)-]', '', name)
        name = ' '.join(name.split())
        
        # Validation: must have a real product name
        if name and len(name) > 2 and not re.match(r'^\d+$', name):
            items.append({
                'name': name[:100],
                'price': round(price, 2),
                'receipt_quantity': receipt_quantity,
                'real_quantity': receipt_quantity,
                'comment': '',
                'accepted': True,
                'removed': False
            })
    
    return {'items': items}



def get_env_model():
    return os.getenv('VISION_MODEL', 'nvidia/nemotron-nano-12b-v2-vl:free')


def get_api_key():
    """Get API key from environment."""
    return os.getenv('OPENROUTER_API_KEY')


def image_to_text(image_path, api_key, model):
    # Read file bytes and build a data URL
    try:
        with open(image_path, 'rb') as f:
            image_bytes = f.read()
    except Exception as exc:
        print(f'Error reading image file: {exc}', file=sys.stderr)
        sys.exit(1)

    mime_type = 'image/jpeg'
    ext = os.path.splitext(image_path)[1].lower()
    if ext in ['.png']:
        mime_type = 'image/png'
    elif ext in ['.gif']:
        mime_type = 'image/gif'
    elif ext in ['.webp']:
        mime_type = 'image/webp'

    data_url = f'data:{mime_type};base64,{base64.b64encode(image_bytes).decode("utf-8")}'

    payload = {
        'model': model,
        'messages': [
            {
                'role': 'system',
                'content': 'You are a receipt scanner. Extract ONLY purchased items/products from receipts. Skip totals, taxes, headers, payment info, and store details. Each item must have: product name, quantity (QTY), and price/amount.'
            },
            {
                'role': 'user',
                'content': [
                    {
                        'type': 'text',
                        'text': '''Extract all purchased items from this receipt ONLY. Follow these rules strictly:
1. Extract ONLY product/item lines (things that were bought)
2. SKIP: totals, subtotals, taxes, discounts, payment methods, customer info, store name, store address
3. For EACH item, include: product name, quantity (must always include), and price/amount
4. If quantity is missing, put "1" as default but mark clearly
5. Format each item per line, clear and simple - do NOT use JSON
6. Remove any non-item rows, headers, or metadata

Example format (follow this style):
Item Name - Qty: 2 - ₱100.00
Another Product - Qty: 1 - ₱250.00

DO NOT return: table headers, row numbers, totals, or anything that's not an actual purchased item.'''
                    },
                    {
                        'type': 'image_url',
                        'image_url': {
                            'url': data_url
                        }
                    }
                ]
            }
        ],
        'temperature': 0.0,
        'max_tokens': 12000
    }

    url = 'https://openrouter.ai/api/v1/chat/completions'
    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json'
    }
    
    # Create SSL context that doesn't verify certificates (development workaround)
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode('utf-8'),
        headers=headers,
        method='POST'
    )

    try:
        with urllib.request.urlopen(request, context=ssl_context, timeout=120) as response:
            raw = response.read().decode('utf-8')
            data = json.loads(raw)
    except urllib.error.HTTPError as http_err:
        err_body = http_err.read().decode('utf-8', errors='ignore')
        print(f'HTTP Error {http_err.code}: {err_body}', file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as url_err:
        print(f'Network Error: {url_err}', file=sys.stderr)
        sys.exit(1)
    except Exception as exc:
        print(f'Unexpected error: {exc}', file=sys.stderr)
        sys.exit(1)

    choices = data.get('choices') or []
    if not choices:
        print('No choices returned from OpenRouter', file=sys.stderr)
        sys.exit(1)

    message = choices[0].get('message') or {}
    content = message.get('content') if message else data.get('choices', [])[0].get('text')
    
    # Parse the LLM response flexibly (not strict JSON)
    parsed = parse_receipt_response(content)
    
    if not parsed or not parsed.get('items'):
        print('{}', file=sys.stderr)  # Empty result
        parsed = {'items': []}

    print(json.dumps(parsed, ensure_ascii=False))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python_ocr.py <image_file_path>', file=sys.stderr)
        sys.exit(1)

    api_key = get_api_key()
    model = get_env_model()
    try:
        image_to_text(sys.argv[1], api_key, model)
    except Exception as e:
        print(f'Error: {e}', file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
