# Today’s lessons

## Read-only first release

- Select a single work calendar with Tony. Its read-only OAuth connection belongs to his verified Instructor Assistant identity. An absent connection leaves the page disconnected. Provision the Google OAuth read scope on a dedicated account with only the approved work calendar shared to it. The API’s configured calendar ID limits the app query; it does not limit the Google account’s OAuth grant. Anna and private calendars must stay outside the connection.
- On open or refresh, request the current Canberra day with recurrence expanded. Use only timed driving lessons and assessments. Cancelled events, non-lesson events and entries starting on the previous local day are excluded. Calendar source and contacts are not persisted in D1, logs or the ACTGDS integration.
- Use structured event fields and the Cal.com booking blocks for name, pickup, phone and email. A missing or ambiguous contact remains blank. On hold until a real connection can be authorised in the non-production environment.
- Offer directions from the current device or the previous booked address, and show gaps or overlaps. Map navigation supplies its own travel time on tap. In-app traffic ETA and leave time are later pieces, with a configurable parking buffer. Keep the actual traffic estimate separate from scheduled minutes between lessons.
- A coach manually chooses the learner and sees their CBT&A progress, ready reviews, licence reminders, and recent lesson comments. Continue into that learner’s record with one tap. The app never creates a learner or links records on the basis of calendar text.
- Provide the Australian Government National Public Toilet Map as a quick link.

## Later steps

- Coach reminders: the next lesson, leave-by time after live ETA is available, and tight transfers. On-device notifications require delivery/permission validation with actual iPhones.
- Customer reminders: use ACTGDS or Cal.com as the sender for website bookings. First confirm existing workflows, approved recipient source, schedule and content. One send per booking and reminder kind; blocked for cancellation, unconfirmed recipients, change or duplicate. Reschedule replaces pending reminders. Calendar viewer remains read-only.
- Comfort: show verified public toilets and hours around route stops, with buffer warnings and an explicit source; add a protected break and optional saved safe public pickup/parking notes. Calculate against the scheduled previous destination or an instructor-approved departure point while keeping contact data out of routing requests.
