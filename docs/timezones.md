# Timezone semantics

Profiles store a valid IANA timezone such as `America/Halifax`. Weekly and date-specific availability are wall-clock rules in the owner's timezone. Bookings are stored and compared as UTC instants.

## Conversion rules

- The public calendar labels dates and slots in the selected display timezone.
- Availability dates always refer to the owner's local calendar date.
- Conversion to UTC occurs in the deterministic scheduling boundary, not independently across UI components.
- Invalid IANA zones and nonexistent local times are rejected.
- Ambiguous fall-back times require a deterministic offset choice and must remain distinguishable in the UI/API.
- Native `Date` parsing of timezone-less strings is not an accepted scheduling primitive.

## Regression matrix

Tests must include UTC, `America/Halifax`, and a non-hour-offset zone such as `Asia/Kolkata`, plus:

- the spring-forward gap;
- both occurrences of a fall-back hour;
- a slot crossing UTC midnight but not the owner's date;
- a viewer on the preceding/following calendar day;
- year and month boundaries.

Tests use a fixed clock and explicit timezone fixtures so developer-machine settings cannot change results.
