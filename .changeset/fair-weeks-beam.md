---
"@remix-run/router": patch
---

Do not short circuit navigation logic if no matches are found requiring revalidation if a user-provided `dataStrategy` exists since it may want to change the revalidation behavior
