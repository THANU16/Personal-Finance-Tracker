// docs/07 §2/§3 — no sideways scrolling on phones. Add to a small data table's className and,
// below md, each row becomes a wrapped line of its cells (header row hidden, padding dropped);
// md+ is the normal table. For long tables with actions prefer a card list (DataTable slots).
export const stackOnPhone =
  "max-md:block max-md:[&_thead]:hidden max-md:[&_tbody]:block max-md:[&_tfoot]:block max-md:[&_tr]:flex max-md:[&_tr]:flex-wrap max-md:[&_tr]:items-baseline max-md:[&_tr]:gap-x-3 max-md:[&_tr]:gap-y-1 max-md:[&_tr]:py-2 max-md:[&_td]:p-0 max-md:[&_td]:whitespace-normal max-md:[&_th]:p-0";
