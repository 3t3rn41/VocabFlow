-- ================================================================
--  VocabFlow 用户系统迁移修复脚本 (v2)
--  针对 srs_cards 已迁移、review_logs 部分迁移、其余表未迁移的情况
-- ================================================================

USE vocabflow;

-- 确保有默认用户 (id=1)
INSERT INTO `users` (`id`, `username`, `password_hash`)
VALUES (1, 'admin', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy')
ON DUPLICATE KEY UPDATE `id` = `id`;

-- ================================================================
--  review_logs: user_id 已添加, idx_word_id 已删除
--  保留 idx_book_id (被外键 fk_logs_book 使用)
-- ================================================================
ALTER TABLE `review_logs` DROP INDEX `idx_reviewed_at`;

ALTER TABLE `review_logs` ADD KEY `idx_user_word_id` (`user_id`, `word_id`);
ALTER TABLE `review_logs` ADD KEY `idx_user_book_id` (`user_id`, `book_id`);
ALTER TABLE `review_logs` ADD KEY `idx_user_reviewed_at` (`user_id`, `reviewed_at`);
ALTER TABLE `review_logs` ADD CONSTRAINT `fk_logs_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE;

-- ================================================================
--  sentence_progress: 添加 user_id 列
-- ================================================================
ALTER TABLE `sentence_progress` ADD COLUMN `user_id` BIGINT NOT NULL DEFAULT 1 COMMENT '所属用户ID' AFTER `id`;

ALTER TABLE `sentence_progress` DROP INDEX `uk_band_topic_dialogue`;
ALTER TABLE `sentence_progress` DROP INDEX `idx_band_topic`;

ALTER TABLE `sentence_progress` ADD UNIQUE KEY `uk_user_band_topic_dialogue` (`user_id`, `band`, `topic_idx`, `dialogue_idx`);
ALTER TABLE `sentence_progress` ADD KEY `idx_user_band_topic` (`user_id`, `band`, `topic_idx`);
ALTER TABLE `sentence_progress` ADD CONSTRAINT `fk_progress_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE;

-- ================================================================
--  sentence_position: 添加 user_id 列
-- ================================================================
ALTER TABLE `sentence_position` ADD COLUMN `user_id` BIGINT NOT NULL DEFAULT 1 COMMENT '所属用户ID' AFTER `id`;

ALTER TABLE `sentence_position` ADD UNIQUE KEY `uk_user_id` (`user_id`);
ALTER TABLE `sentence_position` ADD CONSTRAINT `fk_position_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE;

-- ================================================================
--  user_settings: 添加 user_id 列
-- ================================================================
ALTER TABLE `user_settings` ADD COLUMN `user_id` BIGINT NOT NULL DEFAULT 1 COMMENT '所属用户ID' AFTER `id`;

ALTER TABLE `user_settings` ADD UNIQUE KEY `uk_user_id` (`user_id`);
ALTER TABLE `user_settings` ADD CONSTRAINT `fk_settings_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE;

-- ================================================================
--  active_book: 添加 user_id 列
-- ================================================================
ALTER TABLE `active_book` ADD COLUMN `user_id` BIGINT NOT NULL DEFAULT 1 COMMENT '所属用户ID' AFTER `id`;

ALTER TABLE `active_book` ADD UNIQUE KEY `uk_user_id` (`user_id`);
ALTER TABLE `active_book` ADD CONSTRAINT `fk_active_book_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE;

-- ================================================================
--  sentence_mastery: 添加 user_id 列
-- ================================================================
ALTER TABLE `sentence_mastery` ADD COLUMN `user_id` BIGINT NOT NULL DEFAULT 1 COMMENT '所属用户ID' AFTER `id`;

ALTER TABLE `sentence_mastery` DROP INDEX `uk_band_topic_dialogue`;
ALTER TABLE `sentence_mastery` DROP INDEX `idx_band_topic`;

ALTER TABLE `sentence_mastery` ADD UNIQUE KEY `uk_user_band_topic_dialogue` (`user_id`, `band`, `topic_idx`, `dialogue_idx`);
ALTER TABLE `sentence_mastery` ADD KEY `idx_user_band_topic` (`user_id`, `band`, `topic_idx`);
ALTER TABLE `sentence_mastery` ADD CONSTRAINT `fk_mastery_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE;

-- ================================================================
--  sentence_practice_log: 添加 user_id 列
-- ================================================================
ALTER TABLE `sentence_practice_log` ADD COLUMN `user_id` BIGINT NOT NULL DEFAULT 1 COMMENT '所属用户ID' AFTER `id`;

ALTER TABLE `sentence_practice_log` DROP INDEX `idx_band_topic_dialogue`;
ALTER TABLE `sentence_practice_log` DROP INDEX `idx_practiced_at`;

ALTER TABLE `sentence_practice_log` ADD KEY `idx_user_band_topic_dialogue` (`user_id`, `band`, `topic_idx`, `dialogue_idx`);
ALTER TABLE `sentence_practice_log` ADD KEY `idx_user_practiced_at` (`user_id`, `practiced_at`);
ALTER TABLE `sentence_practice_log` ADD CONSTRAINT `fk_practice_log_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE;

-- ================================================================
--  迁移完成
-- ================================================================
SELECT '用户系统迁移修复完成！' AS message;
