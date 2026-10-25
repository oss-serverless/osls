export default Boolean(
  process.pkg && /^(?:\/snapshot\/|[A-Z]+:\\snapshot\\)/.test(import.meta.dirname)
);
