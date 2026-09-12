// Turns a visible label ("Systolic BP") into a stable id ("field-systolic-bp")
// so a <label htmlFor> can be programmatically linked to its <input> - most
// form fields across the app previously had a label sitting next to an
// input with no such link, so a screen reader announced the input with no
// accessible name at all.
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
