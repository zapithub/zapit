export function parsePagination(query, defaults = { page:1, limit:20, maxLimit:100 }) {
  let page = parseInt(query.page, 10) || defaults.page;
  let limit = parseInt(query.limit, 10) || defaults.limit;
  page = Math.max(1, page);
  limit = Math.min(defaults.maxLimit, Math.max(1, limit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}
