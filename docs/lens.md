# Lens

Lens identifies an item from one to four photos. It is a page at `/lens`, in the Inventory navigation, and it works inside the installed phone app. Take photo uses the same camera input as item photos (`capture="environment"`). Add images uses the file picker. Photos are resized in the browser before they are sent. They are not stored unless you attach them to an item.

## Setup

Set these on the server. In Vercel they are Environment Variables for the ITS project. Do not prefix them with `NEXT_PUBLIC_`.

- `GEMINI_API_KEY` — required. Without it, Lens shows “not configured” and does not call Google.
- `GEMINI_MODEL` — optional. When it is empty, Lens uses `gemini-3.5-flash-lite`. Set it to `gemini-3.8-flash` only when a harder photo is worth the higher price. That model does not accept `minimal` thinking, so Lens uses `low` for it.

The key is sent only as the `x-goog-api-key` header to the Gemini Developer API (`generativelanguage.googleapis.com`). It is not a Vertex AI request. It is not written to logs and it is not returned to the browser. The status request returns whether a key is set and which model name will be used.

Each photo is resized in the browser to a 1280 pixel JPEG at quality 0.8 before it is uploaded. That path is the same on Android Chrome and on iOS Safari, including the installed app. Take photo uses the camera (`capture="environment"`). Add images accepts a JPEG, PNG, WebP, or iOS HEIC file and converts it to JPEG. EXIF orientation is applied, so a portrait camera photo stays portrait, and the long edge is capped while the picture is decoded so a full-size camera bitmap is not drawn. If the phone cannot resize a photo, Lens shows that error and does not upload the original. Identify calls Flash-Lite once, with `minimal` thinking, the current JSON response format, and at most 1024 output tokens, and the server waits up to 50 seconds for Google to answer. That stays under the 60 second function limit, and it is long enough to keep an answer that arrives in about 20 seconds instead of throwing away a call Google still bills. The page does not start a second timer. There is no retry. The Identify button stays disabled, and a second click does nothing, until that one call finishes. The response is not streamed: Google does not send the answer until generation finishes. Item search runs only after Google responds, so the inventory candidate list is not part of the Gemini prompt. The prompt’s only list is the taxonomy names, at most 80. On the paid tier, one photo is about $0.002 and stays under about $0.003 even if the model uses the whole output cap. Four photos stay under about half a cent. Google bills thinking tokens even when the client gives up, which is why the old 3.8 Flash call could cost several cents after a timeout. A raw phone photo is not sent: the resized request stays under Vercel’s 4.5 MB body limit. The page shows the cause when Google rejects the call, including the error name, the cause, the elapsed milliseconds, and the image size. The key itself is never included in that message. The server log records the same facts plus the Vercel region, the Google status, and token counts. It does not record the key or the photo.

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
