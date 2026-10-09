-- automations 0005: mysql_long_text
-- TEXT caps at 64KB on MySQL, too small for big definitions, webhook bodies and step output.

ALTER TABLE `p_automations_automations` MODIFY COLUMN `definition` longtext NOT NULL;
ALTER TABLE `p_automations_runs` MODIFY COLUMN `trigger_context` longtext;
ALTER TABLE `p_automations_run_steps` MODIFY COLUMN `output` longtext;
