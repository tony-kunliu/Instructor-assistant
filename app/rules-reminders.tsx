import { ADI_AUDIT_BOOKING_LINK_TEXT, ADI_AUDIT_BOOKING_NOTE, ADI_AUDIT_BOOKING_URL, type Reminder } from "@/lib/rules.ts";

/** Display-only assessment-rule reminders (spec D1/D2). Never disables or changes anything. */
export function RulesReminders({ reminders, testId }: { reminders: readonly Reminder[]; testId: string }) {
  if (!reminders.length) return null;
  return (
    <div className="reminders" data-testid={testId}>
      {reminders.map((reminder) => (
        <p key={reminder.id} className={`reminder ${reminder.tone}`} data-tone={reminder.tone}>{reminder.text}</p>
      ))}
    </div>
  );
}

/** D3: a plain link to ADI Audit's online booking form plus the one-line note. Nothing about bookings is stored. */
export function BookingLink() {
  return (
    <p className="reminder booking" data-testid="adi-booking">
      <a href={ADI_AUDIT_BOOKING_URL} target="_blank" rel="noopener noreferrer" data-testid="adi-booking-link">{ADI_AUDIT_BOOKING_LINK_TEXT}</a>
      <small>{ADI_AUDIT_BOOKING_NOTE}</small>
    </p>
  );
}
