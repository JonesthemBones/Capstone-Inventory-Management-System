import math
import base64
import json
import os
import re
import sys
import urllib.error
import urllib.request
import ssl
import certifi


def extract_json_payload(text):
    if not text or not isinstance(text, str):
        return None

    normalized = text.strip()
    if not normalized:
        return None

    try:
        return json.loads(normalized)
    except Exception:
        match = re.search(r'\{[\s\S]*\}|\[[\s\S]*\]', normalized)
        if not match:
            return None

        try:
            return json.loads(match.group(0))
        except Exception:
            return None


def normalize_item(item):
    if not isinstance(item, dict):
        return None

    name = str(item.get('name') or item.get('product_name') or item.get('item_name') or '').strip()
    name = re.sub(r'\s+', ' ', name)[:100].strip()

    def numeric(value):
        if value is None or isinstance(value, bool):
            return None
        try:
            result = float(str(value).replace(',', ''))
            return result if math.isfinite(result) else None
        except (ValueError, TypeError):
            return None

    receipt_quantity = numeric(item.get('quantity', item.get('receipt_quantity')))
    price = numeric(item.get('price', item.get('unit_price')))
    if price is not None:
        price = round(price, 2)

    unit_value = item.get('unit_of_measure') or item.get('unit') or ''
    if isinstance(unit_value, str):
        unit_value = unit_value.strip()
    else:
        unit_value = str(unit_value).strip()

    if unit_value:
        unit_value = re.sub(r'[^\w\s\.\-/&%]+', '', unit_value).upper()
        if len(unit_value) > 20:
            unit_value = unit_value[:20].strip()
    else:
        unit_value = ''

    normalized_item = {
        'name': name,
        'price': price,
        'receipt_quantity': receipt_quantity,
        'real_quantity': receipt_quantity,
        'comment': str(item.get('comment', '') or '').strip(),
        'accepted': bool(item.get('accepted', True)),
        'removed': bool(item.get('removed', False))
    }

    normalized_item['unit_of_measure'] = unit_value
    metadata = item.get('field_confidence')
    metadata = metadata if isinstance(metadata, dict) else {}
    normalized_item['field_confidence'] = {}
    for field, alias in [('name', 'name'), ('real_quantity', 'quantity'), ('unit_price', 'price'), ('unit_of_measure', 'unit_of_measure')]:
        entry = metadata.get(field, metadata.get(alias, {}))
        entry = entry if isinstance(entry, dict) else {}
        score = numeric(entry.get('confidence'))
        normalized_item['field_confidence'][field] = {
            'confidence': score if score is not None and 0 <= score <= 1 else None,
            'issue': str(entry.get('issue') or '')[:500]
        }
    normalized_item['original_fields'] = {
        'name': name, 'real_quantity': receipt_quantity,
        'unit_price': price, 'unit_of_measure': unit_value
    }

    confidence = item.get('confidence')
    if confidence is not None:
        try:
            normalized_item['confidence'] = max(0.0, min(1.0, float(confidence)))
        except Exception:
            pass

    product_code = item.get('product_code')
    if product_code:
        normalized_item['product_code'] = str(product_code).strip()[:50]

    category_slug = item.get('category_slug') or item.get('suggested_category_slug')
    if category_slug:
        normalized_item['category_slug'] = str(category_slug).strip().lower()[:100]

    category_confidence = item.get('category_confidence')
    if category_confidence is not None:
        try:
            normalized_item['category_confidence'] = max(0.0, min(1.0, float(category_confidence)))
        except Exception:
            normalized_item['category_confidence'] = 0.0

    return normalized_item


def parse_receipt_response(text):
    """
    Parse the VLM response into a stable receipt payload.
    Prefers strict JSON, but falls back to the legacy line parser if needed.
    """
    payload = extract_json_payload(text)
    if isinstance(payload, dict) and isinstance(payload.get('items'), list):
        items = []
        for item in payload.get('items', []):
            normalized = normalize_item(item)
            if normalized:
                items.append(normalized)
        supplier = payload.get('supplier') if isinstance(payload.get('supplier'), dict) else {}
        return {'items': items, 'supplier': supplier, 'is_supplier_receipt': payload.get('is_supplier_receipt') is True}

    if isinstance(payload, list):
        items = []
        for item in payload:
            normalized = normalize_item(item)
            if normalized:
                items.append(normalized)
        return {'items': items}

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
            continue

        receipt_quantity = int(qty_match.group(1))

        # Look for price AFTER the qty pattern
        after_qty = line[qty_match.end():]
        price_match = re.search(r'[₱$]?\s*(\d+(?:[,\.]?\d+)*(?:\.\d{2})?)', after_qty)
        if not price_match:
            continue

        price_str = price_match.group(1).replace(',', '')
        try:
            price = float(price_str)
        except ValueError:
            continue

        name = re.split(r'\s*[-–—]\s*|qty[:\s]+', line, flags=re.IGNORECASE)[0].strip()
        name = re.sub(r'[^\w\s\(\)-]', '', name)
        name = ' '.join(name.split())

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



def parse_supplier_response(text):
    if not text or not isinstance(text, str):
        return {'supplier': {}}

    normalized_text = text.replace('\\n', ' ').replace('\\"', '"').replace("\\'", "'").strip()
    payload = extract_json_payload(normalized_text)

    if isinstance(payload, dict):
        for key in ('supplier_name', 'contact_name', 'phone', 'email', 'address', 'tin', 'vat', 'website', 'notes', 'supplier'):
            if key in payload:
                return payload
        if 'items' in payload and isinstance(payload['items'], list):
            return {'supplier': payload['items']}

    if isinstance(payload, list):
        return {'supplier': payload}

    if isinstance(payload, str):
        nested = extract_json_payload(payload)
        if isinstance(nested, dict):
            return nested

    supplier_fields = {}
    for key in ('supplier_name', 'contact_name', 'phone', 'email', 'address', 'tin', 'vat', 'website', 'notes', 'company_name', 'vendor_name'):
        pattern = rf'"?{key}"?\s*:\s*(?:"([^"]*?)"|\'([^\']*?)\'|([^,\n\}}\]]+))'
        match = re.search(pattern, normalized_text, re.IGNORECASE | re.DOTALL)
        if match:
            value = next(group for group in match.groups() if group is not None)
            supplier_fields[key] = value.strip().strip('"').strip("'")

    if supplier_fields:
        return supplier_fields

    lines = normalized_text.splitlines()
    supplier = {}
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        lower = stripped.lower()
        if 'supplier' in lower or 'company' in lower or 'vendor' in lower or 'name' in lower:
            supplier['raw_text'] = stripped
            break

    return {'supplier': supplier or {'raw_text': normalized_text[:500]}}


def get_env_model():
    model = os.getenv('VLM_MODEL') or os.getenv('VISION_MODEL')
    if not model:
        return 'deepseek-v4-flash-vision-exp'
    return model.strip()


def get_api_endpoint():
    return os.getenv('DEEPSEEK_API_ENDPOINT') or 'https://api.deepseek.com/chat/completions'


def get_api_key():
    """Get the DeepSeek API key supplied by the Node server."""
    return os.getenv('DEEPSEEK_API_KEY')


def image_to_text(image_path, api_key, model, task='product', table_image_path=None):
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
    table_data_url = data_url
    if table_image_path:
        with open(table_image_path, 'rb') as table_file:
            table_bytes = table_file.read()
        table_ext = os.path.splitext(table_image_path)[1].lower()
        table_mime = 'image/png' if table_ext == '.png' else 'image/webp' if table_ext == '.webp' else 'image/jpeg'
        table_data_url = f'data:{table_mime};base64,{base64.b64encode(table_bytes).decode("utf-8")}'

    try:
        categories = json.loads(os.getenv('VLM_CATEGORIES_JSON') or '[]')
    except Exception:
        categories = []
    category_options = json.dumps(categories, ensure_ascii=False, separators=(',', ':'))

    if task == 'supplier':
        payload = {
            'model': model,
            'messages': [
                {
                    'role': 'system',
                    'content': 'You are a supplier-details extraction engine. Read the receipt and return ONLY valid JSON describing the supplier/vendor details. Return a compact object with supplier information only; do not include item extraction. Prefer keys like supplier_name, contact_name, phone, email, address, tin, vat, website, and notes. If information is not present, leave the value as null or an empty string. Do not add markdown or commentary.'
                },
                {
                    'role': 'user',
                    'content': [
                        {
                            'type': 'text',
                            'text': 'Extract only supplier details from this receipt. Return JSON only, for example: {"supplier_name":"Acme Supply Co","contact_name":"John Doe","phone":"123-456-7890","email":"sales@acme.com","address":"123 Main St, Manila","tin":null,"vat":null,"website":null,"notes":""}'
                        },
                        {
                            'type': 'image_url',
                            'image_url': {'url': data_url}
                        }
                    ]
                }
            ],
            'temperature': 0.0,
            'max_tokens': 2048
        }
    else:
        payload = {
            'model': model,
            'messages': [
                {
                    'role': 'system',
                    'content': 'You are a receipt extraction, supplier extraction, and product-classification engine. Return ONLY valid JSON. Extract purchased products from supplier receipts, invoices, packing lists, delivery receipts, and consignment receipts, including old, faded, handwritten, or partially photographed documents. A printed item table with quantities and product descriptions is evidence of a supplier document even when the heading or supplier name is hard to read. Set is_supplier_receipt to false only for clearly unrelated images such as portraits or scenery. Never extract products from unrelated images. Select exactly one category_slug from the category list supplied by the user. Never invent a category. Use uncategorized when no listed category fits. Skip totals, taxes, and payment information.'
                },
                {
                    'role': 'user',
                    'content': [
                        {
                            'type': 'text',
                            'text': '''Extract all purchased items from this receipt ONLY and return JSON only.

Use exactly this schema:
{"is_supplier_receipt":true,"supplier":{"supplier_name":"string","contact_name":"string","phone":"string","email":"string","address":"string","tin":"string","vat":"string","website":"string","notes":"string"},"items":[{"name":"string","quantity":1,"price":0.0,"unit_of_measure":"string","confidence":0.0,"category_slug":"string","category_confidence":0.0,"field_confidence":{"name":{"confidence":0.0,"issue":null},"real_quantity":{"confidence":0.0,"issue":null},"unit_price":{"confidence":0.0,"issue":null},"unit_of_measure":{"confidence":0.0,"issue":null}}}]}

Allowed categories:
''' + category_options + '''

Rules:
1. Extract ONLY product/item lines (things that were bought)
If the image is clearly unrelated to a supplier document, return {"is_supplier_receipt":false,"supplier":{},"items":[]}. If it shows an item table on a supplier document, extract its rows even if the document is old, faded, cropped, or marked "invoice to follow". Do not extract items from photos of products, unrelated documents, or customer sales receipts.
2. SKIP totals, subtotals, taxes, discounts, payment methods, and customer information
3. For each item, include name, quantity, price, unit_of_measure, and confidence
4. If quantity is missing or unreadable, use null; never guess or default to 1
5. price means the printed UNIT price, never the line amount. If missing or unreadable, use null
6. If unit_of_measure is missing or unreadable, use an empty string
7. confidence must be a number between 0 and 1
8. Do not include markdown or code fences. Add field_confidence to EVERY item:
"field_confidence":{"name":{"confidence":0.0,"issue":null},"real_quantity":{"confidence":0.0,"issue":null},"unit_price":{"confidence":0.0,"issue":null},"unit_of_measure":{"confidence":0.0,"issue":null}}
Assess each field independently; these are self-reported confidence estimates, not measured accuracy. Use a number from 0 to 1, or null when unavailable. In issue, briefly describe faint text, ambiguous digits, handwriting, crossed-out alternatives, or other uncertainty; otherwise use null. Always flag handwritten corrections or conflicting values even if confident. Missing values must have an issue. Never output user confirmation or review status. Preserve rows with unreadable names using an empty name. Support invoices, packing lists, delivery and consignment receipts.
9. category_slug must exactly match one slug from Allowed categories
10. Classify by the product's purpose and the category descriptions. Use "uncategorized" only when none of the listed categories reasonably applies
11. category_confidence must be a number between 0 and 1
12. Put receipt vendor/store details only in supplier; use empty strings for missing supplier fields
13. Examples: cement, rebar, plywood, tie wire, sand, and gravel are construction-materials; PVC pipe is plumbing; nails are fasteners; cutting discs are power-tools; safety gloves are safety-equipment

Example:
{"is_supplier_receipt":true,"supplier":{"supplier_name":"Acme Hardware","contact_name":"","phone":"","email":"","address":"","tin":"","vat":"","website":"","notes":""},"items":[{"name":"GI Elbow","quantity":2,"price":100.0,"unit_of_measure":"PCS","confidence":0.92,"category_slug":"plumbing","category_confidence":0.96,"field_confidence":{"name":{"confidence":0.92,"issue":null},"real_quantity":{"confidence":0.94,"issue":null},"unit_price":{"confidence":0.91,"issue":null},"unit_of_measure":{"confidence":0.95,"issue":null}}}]}'''
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
            'max_tokens': 4096
        }

    url = get_api_endpoint()
    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json'
    }
    

    ssl_context = ssl.create_default_context(cafile=certifi.where())
    
    def request_completion(request_payload):
        request = urllib.request.Request(
            url,
            data=json.dumps(request_payload).encode('utf-8'),
            headers=headers,
            method='POST'
        )
        with urllib.request.urlopen(request, context=ssl_context, timeout=120) as response:
            response_data = json.loads(response.read().decode('utf-8'))
        choices = response_data.get('choices') or []
        if not choices:
            raise ValueError('No choices returned from DeepSeek')
        message = choices[0].get('message') or {}
        return response_data, message.get('content') if message else choices[0].get('text')

    try:
        data, content = request_completion(payload)
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

    if task == 'supplier':
        parsed = parse_supplier_response(content)
        if not parsed:
            parsed = {'supplier': {}}
        print(json.dumps(parsed, ensure_ascii=False))
        return

    parsed = parse_receipt_response(content)
    if not parsed.get('items'):
        retry_payload = {
            **payload,
            'messages': [
                {'role': 'system', 'content': 'Read the image as a document. Return JSON only with keys supplier, items, and is_supplier_receipt. Look carefully for tabular product rows with quantity, unit, description, unit price, and amount. Consignment receipts, packing lists, and delivery documents count even if faded or marked invoice to follow. Extract each visible product row; use null for unreadable values. For every item, report separate field_confidence scores from 0 to 1 for name, real_quantity, unit_price, and unit_of_measure, with an issue for uncertain or corrected text. These are self-reported estimates, not measured accuracy. If there is no document with product rows, return {"supplier":{},"items":[],"is_supplier_receipt":false}. Do not invent rows or confidence scores for unreadable fields.'},
                {'role': 'user', 'content': [
                    {'type': 'text', 'text': 'Read the item table in this image carefully. Return {"is_supplier_receipt":true,"supplier":{"supplier_name":""},"items":[{"name":"Example product","quantity":2,"price":100.0,"unit_of_measure":"PCS","field_confidence":{"name":{"confidence":0.9,"issue":null},"real_quantity":{"confidence":0.9,"issue":null},"unit_price":{"confidence":0.9,"issue":null},"unit_of_measure":{"confidence":0.9,"issue":null}}}]}. Replace example values with the actual image values. Price is the unit price, not the line amount. Include only rows actually visible. If this is a portrait, scenery, or another image without a supplier item table, return empty items.'},
                    {'type': 'image_url', 'image_url': {'url': table_data_url}}
                ]}
            ]
        }
        try:
            retry_data, retry_content = request_completion(retry_payload)
            retry_parsed = parse_receipt_response(retry_content)
            if retry_parsed.get('items'):
                parsed = retry_parsed
                if not parsed.get('supplier'):
                    parsed['supplier'] = parse_receipt_response(content).get('supplier', {})
                data = retry_data
        except Exception as retry_error:
            print(f'Focused receipt retry failed: {retry_error}', file=sys.stderr)
    parsed['_extraction'] = {'model': model, 'prompt_version': 'field-confidence-v1'}
    if not parsed or not parsed.get('items'):
        parsed = {'items': [], 'is_supplier_receipt': parsed.get('is_supplier_receipt') is True if isinstance(parsed, dict) else False}

    if isinstance(data.get('usage'), dict):
        parsed['_usage'] = data['usage']

    print(json.dumps(parsed, ensure_ascii=False))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python_vlm.py <image_file_path> [product|supplier]', file=sys.stderr)
        sys.exit(1)

    task = (sys.argv[2] if len(sys.argv) > 2 else 'product').strip().lower()
    if task not in {'product', 'supplier'}:
        task = 'product'

    api_key = get_api_key()
    if not api_key:
        print('DeepSeek API key is not configured. Restart the Node server after setting DEEPSEEK_API_KEY.', file=sys.stderr)
        sys.exit(1)
    model = get_env_model()
    try:
        image_to_text(sys.argv[1], api_key, model, task=task, table_image_path=sys.argv[3] if len(sys.argv) > 3 else None)
    except Exception as e:
        print(f'Error: {e}', file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
