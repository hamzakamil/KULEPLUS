# E-posta Şablon Envanteri

**Durum:** İskelet — Faz 1'de iskelet, Faz 2'de metinler

## Envanter

| Olay | Şablon adı | Değişkenler | Öncelik | Faz |
|------|-----------|-------------|---------|-----|
| Kayıt doğrulama | `auth.verify_email` | user_name, verify_url | Yüksek | 1 |
| Şifre sıfırlama | `auth.reset_password` | user_name, reset_url | Yüksek | 1 |
| Davet | `core.invitation` | inviter_name, tenant_name, invite_url | Yüksek | 1 |
| Şirket başvuru onayı | `core.tenant_approved` | user_name, tenant_name | Yüksek | 1 |
| Şirket başvuru reddi | `core.tenant_rejected` | user_name, reason | Normal | 1 |
| Hoş geldin | `core.welcome` | user_name, tenant_name, checklist_url | Normal | 1 |
| KVKK/ToS değişikliği | `legal.terms_updated` | user_name, version, effective_date | Yüksek | 2 |
| Abonelik ödeme başarısız | `subscription.payment_failed` | user_name, amount, retry_url | Yüksek | 4 |
| Abonelik yakında bitiyor | `subscription.expiring` | user_name, days_left | Normal | 4 |
| Platform faturası | `billing.invoice` | user_name, invoice_pdf | Yüksek | 4 |
| Günlük özet | `management.daily_digest` | user_name, date, summary | Normal | 7 |
| Haftalık özet | `management.weekly_digest` | user_name, week_summary | Normal | 7 |
| Görev hatırlatıcı | `management.task_reminder` | user_name, task_title, due | Yüksek | 7 |
| Destek grant bildirimi | `platform.support_access_granted` | tenant_name, reason, duration | Yüksek | 1 |
| Pilot DPA imza | `legal.pilot_dpa_signed` | user_name, tenant_name | Normal | 2 |