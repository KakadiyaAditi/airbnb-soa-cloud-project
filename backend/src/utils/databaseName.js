// Supports both SRV and comma-separated replica-set connection strings.
module.exports = (uri) => String(uri).split('?')[0].split('/').pop();
