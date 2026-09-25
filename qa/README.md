# Local frontend checks

Run Vite and open `/qa/frontend.html?lang=en`, with `ru`, `tr` or `ar` alternatives. These fixtures render the production public-status component with synthetic local data: an old check, unknown current status, check regions, independent monitoring disclosure and the current page-generation timestamp. No production API is used.

`/qa/frontend.html?view=auth` renders the reset form with local success feedback. Append `&feedback=error` for the error path. Submission only changes in-memory text; it sends no email. The live regions exist before submission, so verify the announced text as well as their roles. The language selector should preserve unsent input.

`/login` exercises the normal entry without submitting credentials. Its fixed stats must visibly carry the localized example label on desktop. Mobile intentionally hides that illustration. Legal links point to the production document domain; review the unpublished documents on the marketing preview origin instead.

These separate HTML entries are not in Vite's production build inputs and are not copied into `dist`.
