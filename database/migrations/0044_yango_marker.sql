UPDATE settings SET key = 'yango_trial_initialized' WHERE key = 'yange_trial_initialized' AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'yango_trial_initialized');
DELETE FROM settings WHERE key = 'yange_trial_initialized' AND EXISTS (SELECT 1 FROM settings WHERE key = 'yango_trial_initialized');
