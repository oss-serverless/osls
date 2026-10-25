'use strict';

// Removal temporary directory reported occasional crashes on Windows (in CI)
// It's just a cleanup operation, so failure is safe to ignore
// Exported set, lists all error codes we recognize as safe to ignore
module.exports = new Set(['EBUSY', 'EPERM']);
