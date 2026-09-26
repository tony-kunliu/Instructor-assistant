// Exact geometry of public/pdf-template/adi-cbta-checklist.pdf ("Competency
// Based Training and Assessment Lesson Checklist", ACT / Access Canberra,
// form 10,044 (7/2002)), measured from the PDF's own vector rects/text —
// see the coordinate dump used to derive this in the PR description.
//
// All Y coordinates here are "top-down" (distance from the TOP of the page,
// matching how a person reads the page and how pdfplumber reports them).
// PDF's native coordinate space has y=0 at the BOTTOM, so callers must
// convert with `PAGE_HEIGHT - topDownY` when calling pdf-lib's drawing APIs.
//
// This file is pure data (no pdf-lib import) so it can be unit tested and
// reasoned about independently of PDF rendering.

export const PAGE_WIDTH = 842.04;
export const PAGE_HEIGHT = 594.96;

/** Lesson rows on the template's first page (page 1 of the source PDF). */
export const FIRST_PAGE_ROWS = 5;
/** Lesson rows on the template's continuation page (page 2 of the source PDF, repeated as needed). */
export const CONTINUATION_PAGE_ROWS = 6;

/** Column boundaries (x0..x1), shared by both page layouts. */
export const COLUMNS = {
  dateLessonNo: { x0: 28.0, x1: 75.6 },
  timeHrs: { x0: 75.6, x1: 128.4 },
  odometerKms: { x0: 128.4, x1: 181.0 },
  taught: { x0: 181.0, x1: 278.2 },
  assessed: { x0: 278.2, x1: 379.7 },
  achieved: { x0: 379.7, x1: 468.0 },
  location: { x0: 468.0, x1: 561.8 },
  comments: { x0: 561.8, x1: 735.1 },
  signatures: { x0: 735.1, x1: 812.6 },
} as const;

/** Top of each lesson row block on page 1 (5 rows); the table's bottom border follows the last row. */
export const FIRST_PAGE_ROW_TOPS = [141.0, 224.8, 307.8, 390.7, 474.7];
export const FIRST_PAGE_TABLE_BOTTOM = 560.0;

/** Top of each lesson row block on a continuation page (6 rows); the table's bottom border follows the last row. */
export const CONTINUATION_ROW_TOPS = [49.6, 133.2, 217.2, 300.2, 383.3, 466.2];
export const CONTINUATION_TABLE_BOTTOM = 551.5;

/**
 * Offsets (from a row block's own top) of the row's internal dividers:
 *  - `dateSplit` / `signatureSplit`: splits the Date/Lesson-no column and
 *    the ADI/Learner-signature column each into two halves.
 *  - `startFinishSplit` / `finishTotalSplit`: split the Time and Odometer
 *    columns into three (Start / Finish / Total).
 * Taught/Assessed/Achieved/Location/Comments have no internal divider —
 * each is one cell spanning the full row height.
 */
export const ROW_SUB_OFFSETS = {
  startFinishSplit: 28.5,
  dateSplit: 42.2,
  signatureSplit: 42.2,
  finishTotalSplit: 57.0,
};

/** Header fields — page 1 (source PDF) only; continuation pages have no header. */
export const HEADER_FIELDS = {
  adiName: { x0: 81.2, x1: 299.3, top: 56.4, bottom: 69.4 },
  adiNumber: { x0: 372.0, x1: 420.6, top: 56.4, bottom: 69.4 },
  studentName: { x0: 504.6, x1: 714.8, top: 56.4, bottom: 69.4 },
  pageNo: { x0: 755.8, x1: 780.1, top: 56.4, bottom: 69.4 },
  pageOf: { x0: 789.2, x1: 813.8, top: 56.4, bottom: 69.4 },

  address: { x0: 72.7, x1: 299.3, top: 74.7, bottom: 92.0 },
  phone: { x0: 345.1, x1: 456.6, top: 74.7, bottom: 92.0 },
  dob: { x0: 495.4, x1: 580.4, top: 74.7, bottom: 92.0 },
  licenceNumber: { x0: 675.2, x1: 813.7, top: 74.7, bottom: 92.0 },

  expiryDate: { x0: 87.4, x1: 183.4, top: 96.7, bottom: 114.2 },
  eligibility: { x0: 242.4, x1: 336.5, top: 96.7, bottom: 114.2 },
  /** Small checkbox-ish squares just after the "Manual"/"Auto" tags inside their shared box. */
  manualCheckbox: { x0: 389.0, x1: 409.0, top: 99.0, bottom: 112.0 },
  autoCheckbox: { x0: 435.7, x1: 455.7, top: 99.0, bottom: 112.0 },
  schoolWork: { x0: 538.7, x1: 814.1, top: 96.7, bottom: 114.2 },
} as const;
