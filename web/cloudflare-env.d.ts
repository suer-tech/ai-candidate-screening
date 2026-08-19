declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    E2E_PREFLIGHT_TOKEN?: string;
    E2E_LLM_SMOKE_URL?: string;
    E2E_LLM_SMOKE_TOKEN?: string;
    E2E_STT_SMOKE_URL?: string;
    E2E_STT_SMOKE_TOKEN?: string;
    ASSEMBLYAI_API_KEY?: string;
    GOOGLE_DRIVE_HEALTHCHECK_URL?: string;
    GOOGLE_DRIVE_HEALTHCHECK_TOKEN?: string;
    GOOGLE_DRIVE_VACANCY_FOLDER_URL?: string;
    GOOGLE_DRIVE_VACANCY_FOLDER_TOKEN?: string;
    GOOGLE_DRIVE_RESULT_PDF_URL?: string;
    GOOGLE_DRIVE_RESULT_PDF_TOKEN?: string;
    PROTECTED_LLM_TRACES?: R2Bucket;
    LLM_RUNTIME_CONFIG_JSON?: string;
    [key: string]: unknown;
  }
}
