/**
 * Deterministic environment for the test run. lib/* reads these at call time, so
 * nothing here needs to be mocked per-test.
 */
process.env.GROQ_API_KEY = "test-key-not-a-real-secret";
process.env.GROQ_TEXT_MODEL = "llama-3.3-70b-versatile";
process.env.GROQ_FAST_MODEL = "llama-3.1-8b-instant";
process.env.GROQ_VISION_MODEL = "";
process.env.GROQ_TIMEOUT_MS = "5000";
// the 429/5xx backoff must not make the suite sleep; production default is 6s
process.env.GROQ_RETRY_WAIT_MS = "1000";
process.env.MAX_IMAGE_BYTES = "1500000";
process.env.GUEST_MAX_ANALYSES_PER_DAY = "3";
process.env.USER_MAX_ANALYSES_PER_DAY = "20";
process.env.USER_MAX_CHAT_MESSAGES_PER_DAY = "100";
process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON = "";
process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_B64 = "";
process.env.RESEND_API_KEY = "";
process.env.REMINDER_FROM = "";
