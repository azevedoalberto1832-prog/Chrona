create index automation_runs_appointment_fk_idx
  on public.automation_runs (appointment_id)
  where appointment_id is not null;

create index automation_runs_personal_reminder_fk_idx
  on public.automation_runs (personal_reminder_id)
  where personal_reminder_id is not null;

create index personal_reminders_created_by_idx
  on public.personal_reminders (created_by)
  where created_by is not null;

;
