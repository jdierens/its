---
bump: patch
---

eBay listing refresh stores the listing picture. ActiveList does not return PictureURL, so the pull reads it from GetSellerList. Thumbnails on the listings page use that URL.
