# A Country Lock holds only if every unrefunded Purchase is locked

A Student can hold several Purchases of one course, for example one bought in India, refunded, and then one bought in the US. The Country Lock (ADR-0009) ignores Purchases with an Approved Refund Request, and keeps the Student out only if none of the remaining Purchases can be used from where they are now. A refunded Purchase grants nothing (ADR-0002), and one Purchase that is usable here is enough to let them in.

## Considered Options

- **Use whichever Purchase the database returns first**: this was the old behaviour, and it was a bug. A Student could be locked out by a Purchase that had already been refunded.
- **Use the newest Purchase**: rejected. It still locks out a Student who joined through a Claimed Seat after an earlier refunded Purchase, because a seat comes with no Purchase of the Student's own. It also makes access depend on the order Purchases were made in.
