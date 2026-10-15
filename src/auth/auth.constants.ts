/**
 * UUID системного пользователя для dev/CI (`AUTH_DISABLED=true`).
 *
 * Создаётся миграцией `0004_add_users.sql` с детерминированным id, поэтому
 * значение обязано совпадать с SQL (KI-106).
 */
export const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';

/** Email системного пользователя (пароль отключён: `scrypt$disabled$disabled`). */
export const DEMO_USER_EMAIL = 'system@workflow-builder.local';
