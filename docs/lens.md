# Lens

Lens identifies an item from one to four photos. It is a page at `/lens`, in the Inventory navigation, and it works inside the installed phone app. Take photo uses the same camera input as item photos (`capture="environment"`). Add images uses the file picker. Photos are resized in the browser before they are sent. They are not stored unless you attach them to an item.

## Setup

Set these on the server. In Vercel they are Environment Variables for the ITS project. Do not prefix them with `NEXT_PUBLIC_`.

- `GEMINI_API_KEY` — required. Without it, Lens shows “not configured” and does not call Google.
- `GEMINI_MODEL` — optional. When it is empty, Lens uses `gemini-3.8-flash`.

The key is sent only as the `x-goog-api-key` header to the Gemini Developer API (`generativelanguage.googleapis.com`). It is not a Vertex AI request. It is not written to logs and it is not returned to the browser. The status request returns whether a key is set and which model name will be used.

Identify asks Gemini 3.8 Flash for a short answer and waits up to 50 seconds. The page shows the cause when Google rejects the call: invalid key, unknown model, quota or billing, a payload that is too large, or a timeout. The key itself is never included in that message.

AI Studio does not keep `generateContent` requests in Logs unless logging is turned on. In AI Studio open Logs and datasets, select the project, and enable logging. Storage is only offered for a paid-tier project. Dashboard usage is separate from those logs and can show calls even when request logs are off. Logs can also lag.

Preview deployments accept `GET /api/lens?probe=1`. That makes one short text call and returns Google's status, latency, selected response headers, and the error text. It returns the last four characters of the key and never the key. Production does not serve the probe.

## What the reading contains

Google returns structured JSON: manufacturer, every visible part number (including FRU, OPN, and S-spec strings), model, item type, a taxonomy name chosen from the current ITS taxonomy list, key specs, condition hints, the text that was read, and a confidence from 0 to 1.

## How matches are ranked

Lens searches `items` with `lens_item_candidates`. A candidate can match the SKU, part number, OEM part number, model, or the Spec Code attribute. Exact matches ignore spaces and punctuation. Fuzzy matches use `pg_trgm` similarity. The extension was already installed; migration `20261020061349` adds trigram indexes and the lookup function. It does not enable row level security.

The ranker then scores each candidate:

- Exact SKU is strongest, then part number and OEM part number, then Spec Code, then model.
- A fuzzy match counts only when similarity is at least 0.45.
- A matching manufacturer or taxonomy adds a small boost.

The list shows the score as a percent and the reasons, such as “Part number matches …”. The quantity column is the item quantity. That row is where warehouse stock can be shown later. Tap the name to open the item.

## After a match

- **Add these photos to this item** uploads the shots onto that item and opens it.
- **Create new item** opens a form filled with the reading. Saving creates the item, attaches the photos, and opens it.

Identify is limited to eight calls per ten minutes per caller, four images, and about 2 MB of image data in total.
