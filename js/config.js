// Configuration file for application settings

// Email obfuscation configuration
export const EMAIL_CONFIG = {
    parts: ['dbag', 'ory', '@', 'icl', 'oud.com'],
    getEmail: function () {
        return this.parts.join('');
    },
    getEmailParam: function () {
        return `mailto=${encodeURIComponent(this.getEmail())}`;
    }
};

// API configuration
export const API_CONFIG = {
    // Don't modify as it's the max OpenCitations allows
    rateLimiter: {
        maxConcurrent: 5
    },
    cache: {
        expiryDays: 7
    },
    crossref: {
        batchSize: 50 // Crossref allows up to 50 DOIs per batch request
    }
};