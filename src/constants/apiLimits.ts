

// IMAGE LIMITS

/**
 * Maximum base64-encoded image size (API enforced).
 * The API rejects images where the base64 string length exceeds this value.
 * Note: This is the base64 length, NOT raw bytes. Base64 increases size by ~33%.
 */
export const API_IMAGE_MAX_BASE64_SIZE = 5 * 1024 * 1024 

export const IMAGE_TARGET_RAW_SIZE = (API_IMAGE_MAX_BASE64_SIZE * 3) / 4 

export const IMAGE_MAX_WIDTH = 2000
export const IMAGE_MAX_HEIGHT = 2000

// PDF LIMITS

/**
 * Maximum raw PDF file size that fits within the API request limit after encoding.
 * The API has a 32MB total request size limit. Base64 encoding increases size by
 * ~33% (4/3), so 20MB raw → ~27MB base64, leaving room for conversation context.
 */
export const PDF_TARGET_RAW_SIZE = 20 * 1024 * 1024 

export const API_PDF_MAX_PAGES = 100

export const PDF_EXTRACT_SIZE_THRESHOLD = 3 * 1024 * 1024 

export const PDF_MAX_EXTRACT_SIZE = 100 * 1024 * 1024 

export const PDF_MAX_PAGES_PER_READ = 20

export const PDF_AT_MENTION_INLINE_THRESHOLD = 10

// MEDIA LIMITS

/**
 * Maximum number of media items (images + PDFs) allowed per API request.
 * The API rejects requests exceeding this limit with a confusing error.
 * We validate client-side to provide a clear error message.
 */
export const API_MAX_MEDIA_PER_REQUEST = 100
